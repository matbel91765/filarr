import { describe, it, expect } from 'vitest';
import { MentionExtension, MENTION_NODE_NAME } from '../mentionExtension';

/**
 * LA FORME HTML EST UN CONTRAT ENTRE TROIS ÉDITEURS (bureau, web, mobile).
 * La changer casserait les mentions écrites par les autres : ce test la fige.
 */
describe('nœud mention — forme HTML commune', () => {
  it('rend <span data-type="mention" data-user-id data-label>@label</span>', () => {
    const render = MentionExtension.config.renderHTML as unknown as (args: {
      node: { attrs: Record<string, unknown> };
      HTMLAttributes: Record<string, unknown>;
    }) => unknown[];
    const out = render({
      node: { attrs: { userId: 'u-42', label: 'Mathis' } },
      HTMLAttributes: { 'data-user-id': 'u-42', 'data-label': 'Mathis' },
    });
    expect(out[0]).toBe('span');
    expect(out[1]).toMatchObject({
      'data-type': 'mention',
      'data-user-id': 'u-42',
      'data-label': 'Mathis',
      class: 'note-mention',
    });
    expect(out[2]).toBe('@Mathis');
  });

  it('ne se lit que sur span[data-type="mention"], et retrouve le libellé dans le texte à défaut d’attribut', () => {
    const parse = MentionExtension.config.parseHTML as unknown as () => Array<{ tag: string }>;
    expect(parse()[0].tag).toBe('span[data-type="mention"]');
    const attrs = (
      MentionExtension.config.addAttributes as unknown as () => Record<
        string,
        {
          parseHTML: (el: {
            getAttribute: (k: string) => string | null;
            textContent: string;
          }) => string;
        }
      >
    )();
    const el = {
      getAttribute: (k: string) => (k === 'data-user-id' ? 'u-42' : null),
      textContent: '@Mathis',
    };
    expect(attrs.userId.parseHTML(el)).toBe('u-42');
    expect(attrs.label.parseHTML(el)).toBe('Mathis');
  });

  it('est un atome inline, sélectionnable, nommé « mention »', () => {
    expect(MentionExtension.name).toBe(MENTION_NODE_NAME);
    expect(MentionExtension.config.group).toBe('inline');
    expect(MentionExtension.config.inline).toBe(true);
    expect(MentionExtension.config.atom).toBe(true);
  });
});
