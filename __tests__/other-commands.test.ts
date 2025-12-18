const { filesystem, system } = require('gluegun');

const src = filesystem.path(__dirname, '..');

const cli = async (cmd: string) =>
  system.run(`node ${filesystem.path(src, 'bin', 'lt')} ${cmd}`);

describe('Tools Commands', () => {
  describe('lt tools crypt', () => {
    test('generates password hash', async () => {
      const output = await cli('tools crypt testpassword');
      // Should contain a bcrypt hash starting with $2
      expect(output).toContain('$2');
    });
  });

  describe('lt tools sha256', () => {
    test('generates sha256 hash', async () => {
      const output = await cli('tools sha256 test');
      // SHA256 hash is 64 hex characters
      expect(output.trim().length).toBeGreaterThanOrEqual(64);
    });
  });

  describe('lt tools jwt-read', () => {
    test('parses JWT payload', async () => {
      // Sample JWT with payload: { "sub": "1234567890", "name": "Test User", "iat": 1516239022 }
      const sampleJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRlc3QgVXNlciIsImlhdCI6MTUxNjIzOTAyMn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const output = await cli(`tools jwt-read ${sampleJwt}`);
      // Should contain parsed JWT data
      expect(output).toContain('Test User');
      expect(output).toContain('1234567890');
    });
  });
});
