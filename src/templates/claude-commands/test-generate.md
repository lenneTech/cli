---
description: Generate comprehensive tests for changes
---

Analyze recent changes and create appropriate tests:

1. **Identify all changed/new modules**:
   ```bash
   git status --short
   git diff --name-only
   ```

2. **For each new module** in `src/server/modules/`:
   - Create E2E test in `tests/modules/<module-name>.e2e-spec.ts`
   - Analyze existing tests as templates
   - Fully understand TestHelper (read source code)

3. **For each modified module**:
   - Update existing test in `tests/modules/`
   - Test new/changed properties
   - Test changed validations

4. **Security Testing**:
   - Check @Restricted/@Roles decorators
   - Test with Admin User (user.roles contains 'admin')
   - Test with Creator (user.id === object.createdBy)
   - Test with Other User (should fail with 403)
   - Test permission failures

5. **Test Execution**:
   ```bash
   npm run test:e2e
   ```
   - On errors: Debug with console.log
   - Fix errors
   - Re-run tests

6. **Cleanup**:
   - Remove all console.log statements
   - Verify tests still pass

**Important:**
- NEVER weaken @Restricted/@Roles to fix tests
- ALWAYS test with least privileged user
- ALWAYS follow existing test patterns
