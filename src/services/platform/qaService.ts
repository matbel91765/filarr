/**
 * Question Answering Service
 * Extract information from documents by asking natural language questions
 * Uses pattern matching and semantic understanding
 */

// Type definitions
export interface QAResult {
  answer: string;
  confidence: number;
  sources: Array<{
    documentId: string;
    excerpt: string;
    relevance: number;
  }>;
  metadata?: Record<string, any>;
}

export interface Question {
  text: string;
  type: 'factual' | 'extractive' | 'calculation' | 'boolean';
  entities?: string[];
}

export interface DocumentContext {
  id: string;
  content: string;
  metadata?: Record<string, any>;
}

class QAService {
  private isInitialized: boolean = false;
  private patterns: Map<string, RegExp[]> = new Map();

  /**
   * Initialize Q&A service
   */
  async initialize(): Promise<void> {
    try {
      await this.loadPatterns();
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize Q&A service:', error);
      throw error;
    }
  }

  /**
   * Load question patterns for different types
   */
  private async loadPatterns(): Promise<void> {
    // Patterns for extracting specific information
    this.patterns.set('amount', [
      /\$?\d+(?:,\d{3})*(?:\.\d{2})?/g,
      /(?:total|amount|cost|price|value)[:\s]+\$?\d+(?:,\d{3})*(?:\.\d{2})?/gi,
    ]);

    this.patterns.set('date', [
      /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/g,
      /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/gi,
      /\d{4}-\d{2}-\d{2}/g,
    ]);

    this.patterns.set('email', [
      /[\w.-]+@[\w.-]+\.\w+/g,
    ]);

    this.patterns.set('phone', [
      /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    ]);

    this.patterns.set('number', [
      /\b\d+(?:\.\d+)?\b/g,
    ]);
  }

  /**
   * Answer a question based on document context
   */
  async answerQuestion(
    question: string,
    documents: DocumentContext[]
  ): Promise<QAResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Classify question type
      const questionType = this.classifyQuestion(question);

      // Extract key entities from question
      const entities = this.extractEntities(question);

      // Find relevant passages
      const relevantPassages = this.findRelevantPassages(
        question,
        documents,
        entities
      );

      // Extract answer based on question type
      const answer = await this.extractAnswer(
        question,
        questionType,
        relevantPassages,
        entities
      );

      return answer;
    } catch (error) {
      console.error('Failed to answer question:', error);
      return {
        answer: 'Unable to answer question',
        confidence: 0,
        sources: [],
      };
    }
  }

  /**
   * Classify question type
   */
  private classifyQuestion(question: string): Question['type'] {
    const lowerQuestion = question.toLowerCase();

    // Boolean questions
    if (/^(is|are|does|do|can|could|would|will|has|have)\b/i.test(question)) {
      return 'boolean';
    }

    // Calculation questions
    if (/\b(total|sum|average|calculate|compute|count)\b/i.test(lowerQuestion)) {
      return 'calculation';
    }

    // Extractive questions (who, what, when, where)
    if (/\b(who|what|when|where|which)\b/i.test(lowerQuestion)) {
      return 'extractive';
    }

    // Default to factual
    return 'factual';
  }

  /**
   * Extract entities from question
   */
  private extractEntities(question: string): string[] {
    const entities: string[] = [];

    // Extract quoted strings
    const quotedMatches = question.match(/"([^"]+)"/g);
    if (quotedMatches) {
      entities.push(...quotedMatches.map(m => m.replace(/"/g, '')));
    }

    // Extract numbers
    const numberMatches = question.match(/\b\d+\b/g);
    if (numberMatches) {
      entities.push(...numberMatches);
    }

    // Extract capitalized words (potential proper nouns)
    const capitalizedMatches = question.match(/\b[A-Z][a-z]+\b/g);
    if (capitalizedMatches) {
      entities.push(...capitalizedMatches);
    }

    return entities;
  }

  /**
   * Find relevant passages from documents
   */
  private findRelevantPassages(
    question: string,
    documents: DocumentContext[],
    entities: string[]
  ): Array<{
    documentId: string;
    passage: string;
    relevance: number;
  }> {
    const passages: Array<{
      documentId: string;
      passage: string;
      relevance: number;
    }> = [];

    const questionWords = this.tokenize(question);

    documents.forEach(doc => {
      const sentences = this.splitIntoSentences(doc.content);

      sentences.forEach(sentence => {
        const sentenceWords = this.tokenize(sentence);

        // Calculate relevance score
        let relevance = 0;

        // Check entity overlap
        entities.forEach(entity => {
          if (sentence.toLowerCase().includes(entity.toLowerCase())) {
            relevance += 2;
          }
        });

        // Check word overlap
        // Use exact word matching to prevent false positives (e.g., "car" shouldn't match "cartoon")
        const overlap = questionWords.filter(qw =>
          sentenceWords.some(sw => sw === qw)
        );
        relevance += overlap.length;

        if (relevance > 0) {
          passages.push({
            documentId: doc.id,
            passage: sentence,
            relevance,
          });
        }
      });
    });

    // Sort by relevance
    passages.sort((a, b) => b.relevance - a.relevance);

    return passages.slice(0, 10); // Top 10 passages
  }

  /**
   * Extract answer from relevant passages
   */
  private async extractAnswer(
    question: string,
    questionType: Question['type'],
    passages: Array<{ documentId: string; passage: string; relevance: number }>,
    _entities: string[]
  ): Promise<QAResult> {
    if (passages.length === 0) {
      return {
        answer: 'No relevant information found',
        confidence: 0,
        sources: [],
      };
    }

    let answer = '';
    let confidence = 0;

    switch (questionType) {
      case 'calculation':
        const calcResult = this.handleCalculationQuestion(question, passages);
        answer = calcResult.answer;
        confidence = calcResult.confidence;
        break;

      case 'boolean':
        const boolResult = this.handleBooleanQuestion(question, passages);
        answer = boolResult.answer;
        confidence = boolResult.confidence;
        break;

      case 'extractive':
        const extractResult = this.handleExtractiveQuestion(question, passages);
        answer = extractResult.answer;
        confidence = extractResult.confidence;
        break;

      case 'factual':
      default:
        // Return most relevant passage
        answer = passages[0].passage;
        confidence = Math.min(passages[0].relevance / 10, 1);
        break;
    }

    return {
      answer,
      confidence,
      sources: passages.slice(0, 3).map(p => ({
        documentId: p.documentId,
        excerpt: p.passage,
        relevance: p.relevance,
      })),
    };
  }

  /**
   * Handle calculation questions (sum, total, average, etc.)
   */
  private handleCalculationQuestion(
    question: string,
    passages: Array<{ documentId: string; passage: string; relevance: number }>
  ): { answer: string; confidence: number } {
    const numbers: number[] = [];

    // Extract all numbers from passages
    passages.forEach(passage => {
      const matches = passage.passage.match(/\$?\d+(?:,\d{3})*(?:\.\d{2})?/g);
      if (matches) {
        matches.forEach(match => {
          const num = parseFloat(match.replace(/[$,]/g, ''));
          if (!isNaN(num)) {
            numbers.push(num);
          }
        });
      }
    });

    if (numbers.length === 0) {
      return { answer: 'No numerical values found', confidence: 0 };
    }

    let result = 0;
    let operation = '';

    const lowerQuestion = question.toLowerCase();

    if (/\b(total|sum)\b/i.test(lowerQuestion)) {
      result = numbers.reduce((sum, n) => sum + n, 0);
      operation = 'total';
    } else if (/\b(average|mean)\b/i.test(lowerQuestion)) {
      // Guard against division by zero (should never happen due to check above, but defensive)
      result = numbers.length > 0 ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : 0;
      operation = 'average';
    } else if (/\b(count|how many)\b/i.test(lowerQuestion)) {
      result = numbers.length;
      operation = 'count';
    } else {
      result = numbers[0];
      operation = 'value';
    }

    return {
      answer: `The ${operation} is ${result.toFixed(2)}`,
      confidence: 0.8,
    };
  }

  /**
   * Handle boolean questions (yes/no)
   */
  private handleBooleanQuestion(
    _question: string,
    passages: Array<{ documentId: string; passage: string; relevance: number }>
  ): { answer: string; confidence: number } {
    // Check for affirmative or negative indicators in passages
    let positiveScore = 0;
    let negativeScore = 0;

    const positiveWords = ['yes', 'true', 'correct', 'confirmed', 'verified', 'is', 'has', 'does'];
    const negativeWords = ['no', 'not', 'false', 'incorrect', 'never', 'none', 'isn\'t', 'hasn\'t', 'doesn\'t'];

    passages.forEach(passage => {
      const passageLower = passage.passage.toLowerCase();

      positiveWords.forEach(word => {
        if (passageLower.includes(word)) positiveScore += passage.relevance;
      });

      negativeWords.forEach(word => {
        if (passageLower.includes(word)) negativeScore += passage.relevance;
      });
    });

    const answer = positiveScore > negativeScore ? 'Yes' : 'No';
    const confidence = Math.min(
      Math.abs(positiveScore - negativeScore) / Math.max(positiveScore, negativeScore, 1),
      1
    );

    return { answer, confidence };
  }

  /**
   * Handle extractive questions (who, what, when, where)
   */
  private handleExtractiveQuestion(
    _question: string,
    passages: Array<{ documentId: string; passage: string; relevance: number }>
  ): { answer: string; confidence: number } {
    const lowerQuestion = _question.toLowerCase();

    // Determine what type of information to extract
    let extractType = 'general';
    if (/\bwhen\b/.test(lowerQuestion)) extractType = 'date';
    else if (/\bwho\b/.test(lowerQuestion)) extractType = 'person';
    else if (/\bwhere\b/.test(lowerQuestion)) extractType = 'location';
    else if (/\bhow much\b|\bhow many\b/.test(lowerQuestion)) extractType = 'amount';

    // Extract based on type
    for (const passage of passages) {
      const patterns = this.patterns.get(extractType);

      if (patterns) {
        for (const pattern of patterns) {
          const matches = passage.passage.match(pattern);
          if (matches && matches.length > 0) {
            return {
              answer: matches[0],
              confidence: 0.7,
            };
          }
        }
      }
    }

    // Fallback: extract most relevant sentence fragment
    const topPassage = passages[0].passage;
    const fragments = topPassage.split(/[,;]/);

    return {
      answer: fragments[0].trim(),
      confidence: 0.5,
    };
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    return text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * Tokenize text
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);
  }

  /**
   * Extract structured data from document
   */
  async extractStructuredData(
    content: string,
    schema: Record<string, 'string' | 'number' | 'date' | 'email' | 'phone'>
  ): Promise<Record<string, any>> {
    const data: Record<string, any> = {};

    for (const [field, type] of Object.entries(schema)) {
      const patterns = this.patterns.get(type);

      if (patterns) {
        for (const pattern of patterns) {
          const match = content.match(pattern);
          if (match) {
            data[field] = match[0];
            break;
          }
        }
      }
    }

    return data;
  }

  /**
   * Batch answer multiple questions
   */
  async answerMultiple(
    questions: string[],
    documents: DocumentContext[]
  ): Promise<Map<string, QAResult>> {
    const results = new Map<string, QAResult>();

    for (const question of questions) {
      const result = await this.answerQuestion(question, documents);
      results.set(question, result);
    }

    return results;
  }
}

// Export singleton instance
export const qaService = new QAService();

// Export class for testing
export default QAService;
