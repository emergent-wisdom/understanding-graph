import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as sqlite from '../database/sqlite.js';
import {
  createDocumentWriter,
  safeBibliographyBasename,
} from './DocumentWriter.js';
import { getGraphStore, resetGraphStore } from './GraphStore.js';

const PROJECT_ID = 'document-writer-test';

let tmpDir: string;
let outputDir: string;

describe('bibliography filename containment', () => {
  it('accepts basenames but rejects path traversal', () => {
    expect(safeBibliographyBasename('references')).toBe('references');
    expect(safeBibliographyBasename('paper-sources.bib')).toBe('paper-sources');
    expect(safeBibliographyBasename('../outside')).toBeNull();
    expect(safeBibliographyBasename('nested/sources')).toBeNull();
    expect(safeBibliographyBasename('..\\outside')).toBeNull();
  });
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-document-writer-'));
  outputDir = path.join(tmpDir, 'generated');
  sqlite.initDatabase(path.join(tmpDir, PROJECT_ID));
  sqlite.setCurrentProject(PROJECT_ID);
  resetGraphStore();
});

afterEach(() => {
  sqlite.closeAllDatabases();
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('DocumentWriter code filenames', () => {
  it.each([
    ['test_pulseledger.py', 'py', 'test_pulseledger.py'],
    ['__init__.py', 'py', '__init__.py'],
    ['worker.python', 'python', 'worker.py'],
    ['EventStore.test.ts', 'ts', 'EventStore.test.ts'],
  ])(
    'preserves import- and test-significant characters in %s',
    (title, fileType, expected) => {
      const root = getGraphStore().createDocumentNode({
        title,
        content: 'pass',
        isDocRoot: true,
        fileType,
      });

      const result = createDocumentWriter(outputDir).writeDocument(root.id);

      expect(result?.outputPath).toBe(path.join(outputDir, expected));
      expect(fs.existsSync(path.join(outputDir, expected))).toBe(true);
    },
  );

  it('keeps prose filenames slugged while accepting a long-form extension', () => {
    const root = getGraphStore().createDocumentNode({
      title: 'Release Notes.markdown',
      content: 'Ready.',
      isDocRoot: true,
      fileType: 'markdown',
    });

    const result = createDocumentWriter(outputDir).writeDocument(root.id);

    expect(result?.outputPath).toBe(path.join(outputDir, 'release-notes.md'));
  });

  it.each(['../../outside.py', '..\\..\\outside.py'])(
    'never uses path components from %s',
    (title) => {
      const root = getGraphStore().createDocumentNode({
        title,
        content: 'pass',
        isDocRoot: true,
        fileType: 'py',
      });

      const result = createDocumentWriter(outputDir).writeDocument(root.id);

      expect(result?.outputPath).toBe(path.join(outputDir, 'outside.py'));
      expect(fs.existsSync(path.join(outputDir, 'outside.py'))).toBe(true);
    },
  );
});

describe('DocumentWriter prose granularity', () => {
  it('renders contentless filename roots and child containers as structure only', () => {
    const store = getGraphStore();
    const root = store.createDocumentNode({
      title: 'story.md',
      content: 'OLD_ROOT_PROSE',
      isDocRoot: true,
      fileType: 'md',
      level: 'document',
    });
    const container = store.createDocumentNode({
      title: 'Paragraph 7 — Refusal',
      content: 'OLD_CONTAINER_PROSE',
      level: 'paragraph',
      parentId: root.id,
    });
    const first = store.createDocumentNode({
      title: 'Section 1',
      content: 'The answer waited.',
      level: 'paragraph',
      parentId: container.id,
    });
    store.createDocumentNode({
      title: 'Section 2',
      content: '“No,” she said.',
      level: 'paragraph',
      parentId: container.id,
      afterId: first.id,
    });
    sqlite
      .getDb()
      .prepare(
        'UPDATE nodes SET content = NULL, summary = NULL WHERE id IN (?, ?)',
      )
      .run(root.id, container.id);
    store.invalidateCache();

    const result = createDocumentWriter(outputDir).writeDocument(root.id);
    const generated = fs.readFileSync(result?.outputPath || '', 'utf8');

    expect(generated).not.toContain('# story.md');
    expect(generated).not.toContain('OLD_ROOT_PROSE');
    expect(generated).not.toContain('OLD_CONTAINER_PROSE');
    expect(generated).not.toContain('Paragraph 7 — Refusal');
    expect(generated).not.toContain('Section 1');
    expect(generated).not.toContain('Section 2');
    expect(generated).toContain('The answer waited.\n\n“No,” she said.');
  });

  it('keeps section headings while hiding paragraph and sentence labels', () => {
    const store = getGraphStore();
    const craftNote = store.createNode({
      title: 'The cup carries recognition',
      trigger: 'prediction',
      understanding:
        'I expect the cup to remain after the shared memory is gone.',
      why: 'Prospective creative testimony, not manuscript prose.',
    });
    const root = store.createDocumentNode({
      title: 'The Cup',
      content: '# The Cup',
      isDocRoot: true,
      fileType: 'md',
      level: 'document',
    });
    const section = store.createDocumentNode({
      title: 'Scene One',
      content: 'The room held its breath.',
      level: 'section',
      parentId: root.id,
    });
    const paragraph = store.createDocumentNode({
      title: 'Paragraph 01 — Hairline',
      content: 'The crack crossed the painted moon.',
      level: 'paragraph',
      parentId: root.id,
      afterId: section.id,
      expressesIds: [craftNote.id],
    });
    const question = store.createDocumentNode({
      title: 'Pivotal beat — Sentence 1',
      content: '“Will I know you?”',
      level: 'sentence',
      parentId: root.id,
      afterId: paragraph.id,
    });
    store.createDocumentNode({
      title: 'Pivotal beat — Sentence 2',
      content: '“No,” she said.',
      level: 'sentence',
      parentId: root.id,
      afterId: question.id,
    });

    const result = createDocumentWriter(outputDir).writeDocument(root.id);
    const generated = fs.readFileSync(result?.outputPath || '', 'utf8');

    expect(generated).toContain('## Scene One');
    expect(generated).not.toContain('Paragraph 01 — Hairline');
    expect(generated).not.toContain('Pivotal beat — Sentence');
    expect(generated).toContain(
      'The crack crossed the painted moon.\n\n“Will I know you?” “No,” she said.',
    );
    expect(generated).not.toContain(craftNote.title);
    expect(generated).not.toContain(craftNote.understanding);
  });

  it('starts a new sentence paragraph after a section-like node', () => {
    const store = getGraphStore();
    const root = store.createDocumentNode({
      title: 'The Exchange',
      content: '# The Exchange',
      isDocRoot: true,
      fileType: 'md',
      level: 'document',
    });
    const firstSentence = store.createDocumentNode({
      title: 'Sentence 1',
      content: 'The first exchange ended.',
      level: 'sentence',
      parentId: root.id,
    });
    const section = store.createDocumentNode({
      title: 'Interlude',
      content: 'The clock stopped.',
      level: 'section',
      parentId: root.id,
      afterId: firstSentence.id,
    });
    store.createDocumentNode({
      title: 'Sentence 2',
      content: 'The second exchange began.',
      level: 'sentence',
      parentId: root.id,
      afterId: section.id,
    });

    const result = createDocumentWriter(outputDir).writeDocument(root.id);
    const generated = fs.readFileSync(result?.outputPath || '', 'utf8');

    expect(generated).toContain(
      'The first exchange ended.\n\n## Interlude\n\nThe clock stopped.\n\nThe second exchange began.',
    );
  });
});
