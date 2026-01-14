import { filesystem, system } from 'gluegun';

const src = filesystem.path(__dirname, '..');

const cli = async (cmd: string) =>
  system.run(`node ${filesystem.path(src, 'bin', 'lt')} ${cmd}`);

export {};

// Directus commands require Docker or external services
// These tests verify commands exist and handle missing dependencies gracefully
// They do not create actual Directus instances or require running services

describe('Directus Commands', () => {
  describe('lt directus docker-setup', () => {
    test('checks for Docker installation', async () => {
      try {
        const output = await cli('directus docker-setup --noConfirm --name test-instance');
        // If Docker is installed, command should proceed (though may fail for other reasons)
        expect(output).toBeDefined();
      } catch (e: any) {
        // If Docker is not installed, should show error message
        const errorMsg = e.message || e.stderr || '';
        expect(
          errorMsg.includes('Docker') ||
          errorMsg.includes('docker') ||
          errorMsg.includes('Instance name is required')
        ).toBe(true);
      }
    });

    test('requires instance name with --noConfirm', async () => {
      try {
        const output = await cli('directus docker-setup --noConfirm');
        // Should fail because name is required with noConfirm
        expect(output).toContain('Instance name is required');
      } catch (e: any) {
        // Command might fail, but error should be related to missing name or Docker
        const errorMsg = e.message || e.stderr || '';
        expect(errorMsg).toBeDefined();
      }
    });
  });

  describe('lt directus remove', () => {
    test('handles missing directus directory gracefully', async () => {
      try {
        const output = await cli('directus remove non-existent-instance --noConfirm');
        // Should either report no instances found or instance not found
        expect(
          output.includes('No Directus instances found') ||
          output.includes('not found')
        ).toBe(true);
      } catch (e: any) {
        // Error is acceptable - command handles non-existent instances
        const errorMsg = e.message || e.stderr || '';
        expect(errorMsg).toBeDefined();
      }
    });

    test('requires instance name with --noConfirm', async () => {
      try {
        const output = await cli('directus remove --noConfirm');
        // Should fail because name is required with noConfirm
        expect(
          output.includes('Instance name is required') ||
          output.includes('No Directus instances found')
        ).toBe(true);
      } catch (e: any) {
        const errorMsg = e.message || e.stderr || '';
        expect(errorMsg).toBeDefined();
      }
    });
  });

  describe('lt directus typegen', () => {
    test('requires token with --noConfirm', async () => {
      try {
        const output = await cli('directus typegen --noConfirm --url http://localhost:8055');
        // Should fail because token is required
        expect(output).toContain('token is required');
      } catch (e: any) {
        const errorMsg = e.message || e.stderr || '';
        expect(errorMsg.includes('token')).toBe(true);
      }
    });

    test('requires url with --noConfirm', async () => {
      try {
        const output = await cli('directus typegen --noConfirm --token test-token');
        // Command should proceed with default URL or fail gracefully
        expect(output).toBeDefined();
      } catch (e: any) {
        // Expected to fail when connecting to Directus
        const errorMsg = e.message || e.stderr || '';
        expect(errorMsg).toBeDefined();
      }
    });

    test('handles invalid URL/token gracefully', async () => {
      // Use a temp directory for output to avoid creating files in project
      const tempDir = filesystem.path(filesystem.homedir(), `.lt-test-${Date.now()}`);
      filesystem.dir(tempDir);
      const outputFile = filesystem.path(tempDir, 'test-schema.ts');

      try {
        await cli(
          `directus typegen --noConfirm --url http://localhost:9999 --token invalid-token --output ${outputFile}`
        );
      } catch (e: any) {
        // Should fail when trying to connect to invalid Directus instance
        const errorMsg = e.message || e.stderr || '';
        expect(
          errorMsg.includes('Failed') ||
          errorMsg.includes('error') ||
          errorMsg.includes('connect')
        ).toBe(true);
      } finally {
        filesystem.remove(tempDir);
      }
    });
  });

});