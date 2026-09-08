/**
 * Moteur de FORMULES d'une base inline.
 *
 * L'écart le plus visible qui restait avec Notion : une colonne ne pouvait
 * qu'être saisie, jamais calculée. Un budget, un reste-à-faire, un retard en
 * jours se recopiaient à la main — et se démentaient à la première
 * modification.
 *
 * Trois principes, et ils expliquent tout le reste du fichier :
 *
 *  1. **Une formule ne s'écrit JAMAIS dans les cellules.** Sa valeur est
 *     dérivée à l'affichage, comme un agrégat. Une valeur stockée survivrait au
 *     changement de la formule et afficherait un chiffre périmé que rien ne
 *     signale.
 *  2. **Une erreur se dit.** Référence inconnue, division par zéro, parenthèse
 *     manquante : la cellule affiche le motif, elle ne rend pas un zéro
 *     silencieux — sur lequel on prendrait des décisions.
 *  3. **Pas de boucle infinie possible.** Une formule qui en cite une autre est
 *     évaluée avec un chemin de visite ; se recroiser rend une erreur de cycle
 *     plutôt que de faire tourner l'application.
 *
 * Tout est PUR : ni DOM, ni horloge implicite (`now()` reçoit sa date).
 */

import type { DbProperty, DbRow } from './types';

// ==================== Valeurs ====================

export type FormulaValue = number | string | boolean | null;

export interface FormulaError {
  /** Motif lisible, affiché tel quel dans la cellule. */
  message: string;
}

export type FormulaResult = { ok: true; value: FormulaValue } | { ok: false; error: FormulaError };

const err = (message: string): FormulaResult => ({ ok: false, error: { message } });
const ok = (value: FormulaValue): FormulaResult => ({ ok: true, value });

// ==================== Lexique ====================

type TokenType = 'number' | 'string' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'end';

interface Token {
  type: TokenType;
  value: string;
}

const OPERATORS = ['>=', '<=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '>', '<', '=', '!'];

export function tokenize(input: string): Token[] | FormulaError {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: char === '(' ? 'lparen' : 'rparen', value: char });
      i += 1;
      continue;
    }

    if (char === ',') {
      tokens.push({ type: 'comma', value: ',' });
      i += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      let value = '';
      i += 1;
      while (i < input.length && input[i] !== quote) {
        // Échappement : `\"` dans une chaîne, sinon une formule ne peut pas
        // contenir le caractère qui la délimite.
        if (input[i] === '\\' && i + 1 < input.length) {
          value += input[i + 1];
          i += 2;
          continue;
        }
        value += input[i];
        i += 1;
      }
      if (i >= input.length) return { message: 'Unterminated text' };
      i += 1;
      tokens.push({ type: 'string', value });
      continue;
    }

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let value = '';
      while (i < input.length && /[0-9.]/.test(input[i])) {
        value += input[i];
        i += 1;
      }
      if (!Number.isFinite(Number(value))) return { message: `Bad number: ${value}` };
      tokens.push({ type: 'number', value });
      continue;
    }

    if (/[A-Za-zÀ-ÿ_]/.test(char)) {
      let value = '';
      while (i < input.length && /[A-Za-zÀ-ÿ0-9_]/.test(input[i])) {
        value += input[i];
        i += 1;
      }
      tokens.push({ type: 'ident', value });
      continue;
    }

    const op = OPERATORS.find((candidate) => input.startsWith(candidate, i));
    if (op) {
      tokens.push({ type: 'op', value: op === '=' ? '==' : op });
      i += op.length;
      continue;
    }

    return { message: `Unexpected character: ${char}` };
  }

  tokens.push({ type: 'end', value: '' });
  return tokens;
}

// ==================== Arbre ====================

type Node =
  | { kind: 'literal'; value: FormulaValue }
  | { kind: 'prop'; name: string }
  | { kind: 'unary'; op: string; operand: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] };

/** Priorités, du plus faible au plus fort. */
const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

export function parseFormula(input: string): { node: Node } | FormulaError {
  const tokens = tokenize(input);
  if (!Array.isArray(tokens)) return tokens;

  let pos = 0;
  // Le jeton de FIN est collant : sur une formule tronquee (« 1 + », « round( »)
  // l'analyseur consommait la fin puis lisait au-dela du tableau, et levait un
  // TypeError qui remontait jusqu'au rendu de la note. Une formule mal ecrite
  // doit rendre un motif, jamais faire tomber la note qui la porte.
  const last = tokens.length - 1;
  const peek = () => tokens[Math.min(pos, last)];
  const next = () => tokens[Math.min(pos++, last)];

  let failure: FormulaError | null = null;
  const fail = (message: string): Node => {
    if (!failure) failure = { message };
    return { kind: 'literal', value: null };
  };

  const parsePrimary = (): Node => {
    const token = next();
    if (token.type === 'number') return { kind: 'literal', value: Number(token.value) };
    if (token.type === 'string') return { kind: 'literal', value: token.value };

    if (token.type === 'op' && (token.value === '-' || token.value === '!')) {
      return { kind: 'unary', op: token.value, operand: parsePrimary() };
    }

    if (token.type === 'lparen') {
      const inner = parseExpression(0);
      if (peek().type !== 'rparen') return fail('Missing )');
      next();
      return inner;
    }

    if (token.type === 'ident') {
      const lower = token.value.toLowerCase();
      if (lower === 'true') return { kind: 'literal', value: true };
      if (lower === 'false') return { kind: 'literal', value: false };
      if (lower === 'null' || lower === 'empty') return { kind: 'literal', value: null };

      if (peek().type === 'lparen') {
        next();
        const args: Node[] = [];
        if (peek().type !== 'rparen') {
          for (;;) {
            args.push(parseExpression(0));
            if (peek().type === 'comma') {
              next();
              continue;
            }
            break;
          }
        }
        if (peek().type !== 'rparen') return fail('Missing )');
        next();
        // `prop("Nom")` est la forme explicite, la seule qui accepte un nom de
        // colonne avec des espaces.
        if (lower === 'prop') {
          const first = args[0];
          if (first && first.kind === 'literal' && typeof first.value === 'string') {
            return { kind: 'prop', name: first.value };
          }
          return fail('prop() expects a column name in quotes');
        }
        return { kind: 'call', name: lower, args };
      }

      return { kind: 'prop', name: token.value };
    }

    return fail(`Unexpected ${token.value || 'end of formula'}`);
  };

  const parseExpression = (minPrecedence: number): Node => {
    let left = parsePrimary();
    for (;;) {
      const token = peek();
      if (token.type !== 'op') break;
      const precedence = PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      next();
      const right = parseExpression(precedence + 1);
      left = { kind: 'binary', op: token.value, left, right };
    }
    return left;
  };

  const node = parseExpression(0);
  if (failure) return failure;
  if (peek().type !== 'end') return { message: `Unexpected ${peek().value}` };
  return { node };
}

// ==================== Évaluation ====================

export interface FormulaContext {
  properties: DbProperty[];
  row: DbRow;
  /** Date de référence pour `now()` / `today()`, injectée. */
  now?: Date;
  /** Formules déjà traversées : garde-fou anti-cycle. */
  visiting?: Set<string>;
}

function toNumber(value: FormulaValue): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toText(value: FormulaValue): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function truthy(value: FormulaValue): boolean {
  if (value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value.trim() !== '';
}

/** Nombre de jours entre deux dates `YYYY-MM-DD`. */
function dateDiffDays(a: string, b: string): number | null {
  const left = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const right = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(left) || Number.isNaN(right)) return null;
  return Math.round((left - right) / 86_400_000);
}

/**
 * Valeur d'une colonne pour la formule.
 *
 * Une colonne de choix rend son LIBELLÉ, pas son identifiant : personne
 * n'écrirait `prop("Statut") == "o-3f2a"`.
 */
function propertyValue(name: string, ctx: FormulaContext): FormulaResult {
  const property = ctx.properties.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase()
  );
  if (!property) return err(`Unknown column: ${name}`);

  if (property.type === 'formula') {
    const visiting = ctx.visiting ?? new Set<string>();
    if (visiting.has(property.id)) return err('Circular formula');
    return evaluateFormula(property.formula ?? '', {
      ...ctx,
      visiting: new Set([...visiting, property.id]),
    });
  }

  const raw = ctx.row.cells[property.id];
  if (raw === undefined || raw === null) return ok(null);

  if (property.type === 'select' || property.type === 'multiSelect') {
    const ids = Array.isArray(raw) ? raw : [raw];
    const labels = ids
      .map((id) => property.options?.find((option) => option.id === id)?.label)
      .filter((label): label is string => typeof label === 'string');
    return ok(labels.join(', '));
  }

  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string') {
    return ok(raw);
  }
  if (Array.isArray(raw)) return ok(raw.length);
  return ok(null);
}

function evaluateNode(node: Node, ctx: FormulaContext): FormulaResult {
  switch (node.kind) {
    case 'literal':
      return ok(node.value);

    case 'prop':
      return propertyValue(node.name, ctx);

    case 'unary': {
      const operand = evaluateNode(node.operand, ctx);
      if (!operand.ok) return operand;
      if (node.op === '!') return ok(!truthy(operand.value));
      const value = toNumber(operand.value);
      return value === null ? err('Not a number') : ok(-value);
    }

    case 'binary': {
      const left = evaluateNode(node.left, ctx);
      if (!left.ok) return left;
      const right = evaluateNode(node.right, ctx);
      if (!right.ok) return right;

      switch (node.op) {
        case '&&':
          return ok(truthy(left.value) && truthy(right.value));
        case '||':
          return ok(truthy(left.value) || truthy(right.value));
        case '==':
          return ok(toText(left.value) === toText(right.value));
        case '!=':
          return ok(toText(left.value) !== toText(right.value));
        default:
          break;
      }

      // `+` concatène dès qu'un côté est du texte : c'est ce qu'on attend en
      // écrivant `prop("Nom") + " — " + prop("Statut")`.
      if (node.op === '+' && (typeof left.value === 'string' || typeof right.value === 'string')) {
        return ok(toText(left.value) + toText(right.value));
      }

      const a = toNumber(left.value);
      const b = toNumber(right.value);
      if (a === null || b === null) return err('Not a number');

      switch (node.op) {
        case '+':
          return ok(a + b);
        case '-':
          return ok(a - b);
        case '*':
          return ok(a * b);
        case '/':
          // Division par zéro : un motif, jamais l'infini ni un zéro muet.
          return b === 0 ? err('Division by zero') : ok(a / b);
        case '%':
          return b === 0 ? err('Division by zero') : ok(a % b);
        case '<':
          return ok(a < b);
        case '<=':
          return ok(a <= b);
        case '>':
          return ok(a > b);
        case '>=':
          return ok(a >= b);
        default:
          return err(`Unknown operator ${node.op}`);
      }
    }

    case 'call':
      return evaluateCall(node, ctx);

    default:
      return err('Bad formula');
  }
}

function evaluateCall(node: { name: string; args: Node[] }, ctx: FormulaContext): FormulaResult {
  const name = node.name;

  // `if` est évalué PARESSEUSEMENT : évaluer les deux branches ferait remonter
  // l'erreur de celle qu'on n'a pas choisie (c'est le cas d'usage même de
  // `if(prop("Total") == 0, "—", prop("Part") / prop("Total"))`).
  if (name === 'if') {
    if (node.args.length < 2) return err('if() expects 2 or 3 arguments');
    const test = evaluateNode(node.args[0], ctx);
    if (!test.ok) return test;
    if (truthy(test.value)) return evaluateNode(node.args[1], ctx);
    return node.args[2] ? evaluateNode(node.args[2], ctx) : ok(null);
  }

  const args: FormulaValue[] = [];
  for (const arg of node.args) {
    const evaluated = evaluateNode(arg, ctx);
    if (!evaluated.ok) return evaluated;
    args.push(evaluated.value);
  }

  const nums = () => args.map(toNumber);
  const firstNumber = () => toNumber(args[0] ?? null);

  switch (name) {
    case 'not':
      return ok(!truthy(args[0] ?? null));
    case 'and':
      return ok(args.every(truthy));
    case 'or':
      return ok(args.some(truthy));
    case 'isempty':
      return ok(!truthy(args[0] ?? null));
    case 'concat':
      return ok(args.map(toText).join(''));
    case 'join': {
      const [separator, ...rest] = args;
      return ok(rest.map(toText).join(toText(separator ?? '')));
    }
    case 'length':
      return ok(toText(args[0] ?? null).length);
    case 'upper':
      return ok(toText(args[0] ?? null).toUpperCase());
    case 'lower':
      return ok(toText(args[0] ?? null).toLowerCase());
    case 'trim':
      return ok(toText(args[0] ?? null).trim());
    case 'contains':
      return ok(toText(args[0] ?? null).includes(toText(args[1] ?? null)));
    case 'text':
      return ok(toText(args[0] ?? null));
    case 'number': {
      const value = firstNumber();
      return value === null ? ok(null) : ok(value);
    }
    case 'round':
    case 'floor':
    case 'ceil':
    case 'abs':
    case 'sqrt': {
      const value = firstNumber();
      if (value === null) return err('Not a number');
      if (name === 'round') {
        const digits = toNumber(args[1] ?? 0) ?? 0;
        const factor = 10 ** Math.max(0, Math.trunc(digits));
        return ok(Math.round(value * factor) / factor);
      }
      if (name === 'floor') return ok(Math.floor(value));
      if (name === 'ceil') return ok(Math.ceil(value));
      if (name === 'abs') return ok(Math.abs(value));
      return value < 0 ? err('sqrt of a negative number') : ok(Math.sqrt(value));
    }
    case 'min':
    case 'max': {
      const values = nums().filter((value): value is number => value !== null);
      if (values.length === 0) return err('Not a number');
      return ok(name === 'min' ? Math.min(...values) : Math.max(...values));
    }
    case 'today':
    case 'now': {
      const now = ctx.now ?? new Date();
      const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate()
      ).padStart(2, '0')}`;
      return ok(iso);
    }
    case 'datediff': {
      const a = toText(args[0] ?? null);
      const b = toText(args[1] ?? null);
      const days = a && b ? dateDiffDays(a, b) : null;
      return days === null ? err('Not a date') : ok(days);
    }
    default:
      return err(`Unknown function: ${name}()`);
  }
}

/** Analyse puis évalue. Rend toujours un résultat, jamais une exception. */
export function evaluateFormula(source: string, ctx: FormulaContext): FormulaResult {
  if (!source || source.trim() === '') return ok(null);
  try {
    const parsed = parseFormula(source);
    if (!('node' in parsed)) return { ok: false, error: parsed };
    return evaluateNode(parsed.node, ctx);
  } catch {
    // Filet : une formule ne doit JAMAIS faire tomber le rendu de la note.
    // L'analyse est dedans elle aussi — c'est elle qui a deja leve une fois.
    return err('Formula failed');
  }
}

/** Vérifie une formule hors de toute ligne — pour l'éditeur de propriété. */
export function checkFormula(source: string, properties: DbProperty[]): FormulaError | null {
  if (!source || source.trim() === '') return null;
  let parsed: ReturnType<typeof parseFormula>;
  try {
    parsed = parseFormula(source);
  } catch {
    return { message: 'Bad formula' };
  }
  if (!('node' in parsed)) return parsed;

  // Les colonnes citées doivent exister : une faute de frappe dans un nom se
  // voit ainsi tout de suite, et pas ligne par ligne.
  const unknown: string[] = [];
  const walk = (node: Node): void => {
    if (node.kind === 'prop') {
      const found = properties.some(
        (property) => property.name.toLowerCase() === node.name.toLowerCase()
      );
      if (!found && !unknown.includes(node.name)) unknown.push(node.name);
      return;
    }
    if (node.kind === 'unary') walk(node.operand);
    if (node.kind === 'binary') {
      walk(node.left);
      walk(node.right);
    }
    if (node.kind === 'call') node.args.forEach(walk);
  };
  walk(parsed.node);

  return unknown.length > 0 ? { message: `Unknown column: ${unknown.join(', ')}` } : null;
}

/** Mise en forme d'un résultat pour l'affichage d'une cellule. */
export function formatFormulaValue(result: FormulaResult, locale: string): string {
  if (!result.ok) return result.error.message;
  const { value } = result;
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? '✓' : '—';
  if (typeof value === 'number') {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
  }
  return value;
}
