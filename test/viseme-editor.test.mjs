import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Parse-only, because this is deliberately a PRIVATE local-only annotation tool.
// It must never receive customer faces, vocal audio or consent through the server.
const page = readFileSync(new URL('../song_vision/annotation_editor.html', import.meta.url), 'utf8');
test('manual Korean viseme editor is self-contained and JavaScript parses', () => {
  assert.match(page, /lang="ko"/);
  assert.match(page, /id="vocalFile"/);
  assert.match(page, /id="lyrics"/);
  assert.match(page, /id="mark"/);
  assert.match(page, /id="export"/);
  assert.match(page, /crypto\.subtle\.digest/);
  assert.match(page, /SHA-256/);
  assert.doesNotMatch(page, /<script[^>]+src=/);
  const result = page.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(result, 'An inline editor script must exist');
  assert.doesNotThrow(() => new vm.Script(result[1]));
  assert.doesNotMatch(result[1], /\bfetch\s*\(/);
  assert.doesNotMatch(result[1], /XMLHttpRequest/);
  assert.doesNotMatch(result[1], /WebSocket/);
});
test('editor requires explicit human review before exporting', () => {
  assert.match(page, /id="reviewed"/);
  assert.match(page, /alignmentMethod:'human_reviewed'/);
  assert.match(page, /verifiedBy:reviewer/);
  assert.match(page, /vocalSha256:fileHash/);
  assert.match(page, /selected.*\+1/);
});
