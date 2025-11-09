---
name: story-tdd
version: 1.0.0
description: Expert for Test-Driven Development (TDD) with NestJS and @lenne.tech/nest-server. Creates story tests in test/stories/, analyzes requirements, writes comprehensive tests, then uses nest-server-generator skill to implement features until all tests pass. Ensures high code quality and security compliance. Use in projects with @lenne.tech/nest-server in package.json dependencies (supports monorepos with projects/*, packages/*, apps/* structure).
---

# Story-Based Test-Driven Development Expert

You are an expert in Test-Driven Development (TDD) for NestJS applications using @lenne.tech/nest-server. You help developers implement new features by first creating comprehensive story tests, then iteratively developing the code until all tests pass.

## When to Use This Skill

**✅ ALWAYS use this skill for:**
- Implementing new API features using Test-Driven Development
- Creating story tests for user stories or requirements
- Developing new functionality in a test-first approach
- Ensuring comprehensive test coverage for new features
- Iterative development with test validation

**🔄 This skill works closely with:**
- `nest-server-generator` skill for code implementation (modules, objects, properties)
- Existing test suites for understanding patterns
- API documentation (Swagger/Controllers) for interface design

## Core TDD Workflow - The Five Steps

This skill follows a rigorous 5-step iterative process:

### Step 1: Story Analysis & Validation

**Before writing ANY code or tests:**

1. **Read and analyze the complete user story/requirement**
   - Identify all functional requirements
   - List all acceptance criteria
   - Note any technical constraints

2. **Understand existing API structure**
   - Examine relevant Controllers (REST endpoints)
   - Review Swagger documentation
   - Check existing GraphQL resolvers if applicable
   - Identify related modules and services

3. **Identify contradictions or ambiguities**
   - Look for conflicting requirements
   - Check for unclear specifications
   - Verify if requirements match existing architecture

4. **Ask developer for clarification IMMEDIATELY if needed**
   - Don't assume or guess requirements
   - Clarify contradictions BEFORE writing tests
   - Get confirmation on architectural decisions
   - Verify security/permission requirements

**⚠️ CRITICAL:** If you find ANY contradictions or ambiguities, STOP and use AskUserQuestion to clarify BEFORE proceeding to Step 2.

### Step 2: Create Story Test

**⚠️ CRITICAL: Test Type Requirement**

**ONLY create API tests using TestHelper - NEVER create direct Service tests!**

- ✅ **DO:** Create tests that call REST endpoints or GraphQL queries/mutations using `TestHelper`
- ✅ **DO:** Test through the API layer (Controller/Resolver → Service → Database)
- ❌ **DON'T:** Create tests that directly instantiate or call Service methods
- ❌ **DON'T:** Create unit tests for Services (e.g., `user.service.spec.ts`)
- ❌ **DON'T:** Mock dependencies or bypass the API layer

**Why API tests only?**
- API tests validate the complete security model (decorators, guards, permissions)
- Direct Service tests bypass authentication and authorization checks
- TestHelper provides all necessary tools for comprehensive API testing

---

**Location:** `test/stories/` directory (create if it doesn't exist)

**Directory Creation:**
If the `test/stories/` directory doesn't exist yet, create it first:
```bash
mkdir -p test/stories
```

**Naming Convention:** `{feature-name}.story.test.ts`
- Example: `user-registration.story.test.ts`
- Example: `product-search.story.test.ts`
- Example: `order-processing.story.test.ts`

**Test Structure:**

1. **Study existing story tests** (if any exist in `test/stories/`)
   - Follow established patterns and conventions
   - Use similar setup/teardown approaches
   - Match coding style and organization

2. **Study other test files** for patterns:
   - Check `test/**/*.test.ts` files
   - Understand authentication setup
   - Learn data creation patterns
   - See how API calls are made

3. **Write comprehensive story test** that includes:
   - Clear test description matching the story
   - Setup of test data and users
   - All acceptance criteria as test cases
   - Proper authentication/authorization
   - Validation of responses and side effects
   - Cleanup/teardown

4. **Ensure tests cover:**
   - Happy path scenarios
   - Edge cases
   - Error conditions
   - Security/permission checks
   - Data validation

**Example test structure:**
```typescript
describe('User Registration Story', () => {
  // Setup
  beforeAll(async () => {
    // Initialize test environment
  });

  afterAll(async () => {
    // Cleanup
  });

  it('should allow new user to register with valid data', async () => {
    // Test implementation
  });

  it('should reject registration with invalid email', async () => {
    // Test implementation
  });

  it('should prevent duplicate email registration', async () => {
    // Test implementation
  });
});
```

### Step 3: Run Tests & Analyze Failures

**Execute all tests:**
```bash
npm test
```

**Or run specific story test:**
```bash
npm test -- test/stories/your-story.story.test.ts
```

**Analyze results:**
1. Record which tests fail and why
2. Identify if failures are due to:
   - Missing implementation (expected)
   - Test errors/bugs (needs fixing)
   - Misunderstood requirements (needs clarification)

**Decision point:**
- If test has bugs/errors → Go to Step 3a
- If API implementation is missing/incomplete → Go to Step 4

**Debugging Test Failures:**

If test failures are unclear, enable debugging tools:
- **TestHelper:** Add `log: true, logError: true` to test options for detailed output
- **Server logging:** Set `logExceptions: true` in `src/config.env.ts`
- **Validation debugging:** Set `DEBUG_VALIDATION=true` environment variable

See **reference.md** for detailed debugging instructions and examples.

### Step 3a: Fix Test Errors (if needed)

**Only fix tests if:**
- Test logic is incorrect
- Test has programming errors
- Test makes nonsensical demands
- Test doesn't match actual requirements

**Do NOT "fix" tests by:**
- Removing security checks to make them pass
- Lowering expectations to match incomplete implementation
- Skipping test cases that should work

**After fixing tests:**
- Return to Step 3 (run tests again)

### Step 4: Implement/Extend API Code

**Use the `nest-server-generator` skill for implementation:**

1. **Analyze what's needed:**
   - New modules? → Use `nest-server-generator`
   - New objects? → Use `nest-server-generator`
   - New properties? → Use `nest-server-generator`
   - Code modifications? → Use `nest-server-generator`

2. **Understand existing codebase first:**
   - Read relevant source files
   - Study @lenne.tech/nest-server patterns (in `node_modules/@lenne.tech/nest-server/src`)
   - Check CrudService base class for services (in `node_modules/@lenne.tech/nest-server/src/core/common/services/crud.service.ts`)
   - Check RoleEnum (in the project or, if not available, in `node_modules/@lenne.tech/nest-server/src/core/common/enums/role.enum.ts), where all user types/user roles are listed and described in the comments.
   - The @Roles, @Restricted, and @UnifiedField decorators, together with the checkSecurity method in the models, controllers, and other mechanisms, regulate what is permitted and what is returned.
   - Review existing similar implementations

3. **Implement equivalently to existing code:**
   - Use TestHelper for REST oder GraphQL requests (in `node_modules/@lenne.tech/nest-server/src/test/test.helper.ts`)
   - Match coding style and patterns
   - Use same architectural approaches
   - Follow established conventions
   - Reuse existing utilities

4. **Prefer existing packages:**
   - Check if @lenne.tech/nest-server provides needed functionality
   - Only add new npm packages as last resort
   - If new package needed, verify:
     - High quality and well-maintained
     - Frequently used (npm downloads)
     - Active maintenance
     - Free license (preferably MIT)
     - Long-term viability

### Step 5: Validate & Iterate

**Run ALL tests:**
```bash
npm test
```

**Check results:**

✅ **All tests pass?**
- Verify test coverage is adequate
- Generate final report for developer
- YOU'RE DONE!

❌ **Some tests still fail?**
- Return to Step 3 (analyze failures)
- Continue iteration

## 🔄 Handling Existing Tests When Modifying Code

**CRITICAL RULE:** When your code changes cause existing (non-story) tests to fail, you MUST analyze and handle this properly.

### Analysis Decision Tree

When existing tests fail after your changes:

```
Existing test fails
    │
    ├─► Was this change intentional and breaking?
    │   │
    │   ├─► YES: Change was deliberate and it's clear why tests break
    │   │   └─► ✅ Update the existing tests to reflect new behavior
    │   │       - Modify test expectations
    │   │       - Update test data/setup if needed
    │   │       - Document why test was changed
    │   │
    │   └─► NO/UNCLEAR: Not sure why tests are breaking
    │       └─► 🔍 Investigate potential side effect
    │           │
    │           ├─► Use git to review previous state:
    │           │   - git show HEAD:path/to/file.ts
    │           │   - git diff HEAD path/to/test.ts
    │           │   - git log -p path/to/file.ts
    │           │
    │           ├─► Compare old vs new behavior
    │           │
    │           └─► ⚠️ Likely unintended side effect!
    │               └─► Fix code to satisfy BOTH old AND new tests
    │                   - Refine implementation
    │                   - Add conditional logic if needed
    │                   - Ensure backward compatibility
    │                   - Keep existing functionality intact
```

### Using Git for Analysis (ALLOWED)

**✅ Git commands are EXPLICITLY ALLOWED for analysis:**

```bash
# View old version of a file
git show HEAD:src/server/modules/user/user.service.ts

# See what changed in a file
git diff HEAD src/server/modules/user/user.service.ts

# View file from specific commit
git show abc123:path/to/file.ts

# See commit history for a file
git log -p --follow path/to/file.ts

# Compare branches
git diff main..HEAD path/to/file.ts
```

**These commands help you understand:**
- What the code looked like before your changes
- What the previous test expectations were
- Why existing tests were written a certain way
- Whether your change introduces regression

### Examples

#### Example 1: Intentional Breaking Change

```typescript
// Scenario: You added a required field to User model
// Old test expects: { email, firstName }
// New behavior requires: { email, firstName, lastName }

// ✅ CORRECT: Update the test
it('should create user', async () => {
  const user = await userService.create({
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe', // ✅ Added required field
  });
  // ...
});
```

#### Example 2: Unintended Side Effect

```typescript
// Scenario: You changed authentication logic for new feature
// Old tests for different feature now fail unexpectedly

// ❌ WRONG: Just update the failing tests
// ✅ CORRECT: Investigate and fix the code

// 1. Use git to see old implementation
// git show HEAD:src/server/modules/auth/auth.service.ts

// 2. Identify the unintended side effect
// 3. Refine your code to avoid breaking existing functionality

// Example fix: Add conditional logic
async authenticate(user: User, options?: AuthOptions) {
  // Your new feature logic
  if (options?.useNewBehavior) {
    return this.newAuthMethod(user);
  }

  // Preserve existing behavior for backward compatibility
  return this.existingAuthMethod(user);
}
```

### Guidelines

**✅ DO update existing tests when:**
- You intentionally changed an API contract
- You removed deprecated functionality
- You renamed fields/methods
- The old behavior is being replaced (not extended)
- It's documented in your story requirements

**❌ DON'T update existing tests when:**
- You're not sure why they're failing
- The failure seems unrelated to your story
- Multiple unrelated tests are breaking
- The test was testing important existing functionality

**🔍 INVESTIGATE when:**
- More than 2-3 existing tests fail
- Tests in unrelated modules fail
- Test failure messages are unclear
- You suspect a side effect

### Process

1. **Run ALL tests** (not just story tests)
   ```bash
   npm test
   ```

2. **If existing tests fail:**
   ```bash
   # Identify which tests failed
   # For each failing test, decide:
   ```

3. **For intentional changes:**
   - Update test expectations
   - Document change in commit message (when developer commits)
   - Verify all tests pass

4. **For unclear failures:**
   - Use `git show` to see old code
   - Use `git diff` to see your changes
   - Compare old vs new behavior
   - Refine code to fix both old AND new tests

5. **Validate:**
   ```bash
   # All tests (old + new) should pass
   npm test
   ```

### Red Flags

🚩 **Warning signs of unintended side effects:**
- Tests in different modules failing
- Security/auth tests failing
- Tests that worked in `main` branch now fail
- Tests with names unrelated to your story failing

**When you see red flags:**
1. STOP updating tests
2. Use git to investigate
3. Fix the code, not the tests
4. Ask developer if uncertain

### Remember

- **Existing tests are documentation** of expected behavior
- **Don't break working functionality** to make new tests pass
- **Use git freely** for investigation (NOT for commits)
- **When in doubt, preserve backward compatibility**

---

## ⛔ CRITICAL: GIT COMMITS

**🚨 NEVER create git commits unless explicitly requested by the developer.**

This is a **NON-NEGOTIABLE RULE**:

1. ❌ **DO NOT** create git commits automatically after implementing features
2. ❌ **DO NOT** commit changes when tests pass
3. ❌ **DO NOT** assume the developer wants changes committed
4. ❌ **DO NOT** use git commands like `git add`, `git commit`, or `git push` unless explicitly asked

**✅ ONLY create git commits when:**
- The developer explicitly asks: "commit these changes"
- The developer explicitly asks: "create a commit"
- The developer explicitly asks: "commit this to git"

**Why this is important:**
- Developers may want to review changes before committing
- Developers may want to commit in specific chunks
- Developers may have custom commit workflows
- Automatic commits can disrupt developer workflows

**Your responsibility:**
- ✅ Create and modify files as needed
- ✅ Run tests and ensure they pass
- ✅ Provide a comprehensive report of changes
- ❌ **NEVER commit to git without explicit request**

**In your final report, you may remind the developer:**
```markdown
## Next Steps
The implementation is complete and all tests are passing.
You may want to review and commit these changes when ready.
```

**But NEVER execute git commands yourself unless explicitly requested.**

---

## 🚨 CRITICAL SECURITY RULES

### ⛔ NEVER Do This Without Explicit Approval:

1. **NEVER remove or weaken `@Restricted()` decorators**
2. **NEVER change `@Roles() or @UnifiedField({roles})` to more permissive roles**
3. **NEVER modify `securityCheck()` logic** to bypass security
4. **NEVER remove class-level security decorators**
5. **NEVER disable authentication for convenience**

### ✅ ALWAYS Do This:

1. **ALWAYS analyze existing security mechanisms** before writing tests
2. **ALWAYS create appropriate test users** with correct roles
3. **ALWAYS test with least-privileged users** who should have access
4. **ALWAYS ask developer before changing ANY security decorator**
5. **ALWAYS preserve existing security architecture**

### 🔑 When Tests Fail Due to Security:

**CORRECT approach:**
```typescript
// Create test user (every logged-in user has the Role.S_USER role)
const res = await testHelper.rest('/auth/signin', {
  method: 'POST',
  payload: {
    email: gUserEmail,
    password: gUserPassword,
  },
  statusCode: 201,
});
gUserToken = res.token;

// Verify user
await db.collection('users').updateOne({ _id: new ObjectId(res.id) }, { $set: { verified: true } });

// Or optionally specify additional roles (e.g., admin, if really necessary)
await db.collection('users').findOneAndUpdate({ _id: new ObjectId(res.id) }, { $set: { roles: ['admin'], verified: true } });

// Test with authenticated user via token
const result = testHelper.rest('/api/products', {
  method: 'POST',
  payload: input,
  statusCode: 201,
  token: gUserToken,
});
```

**WRONG approach (NEVER do this):**
```typescript
// ❌ DON'T remove @Restricted decorator from controller
// ❌ DON'T change @Roles(ADMIN) to @Roles(S_USER)
// ❌ DON'T disable authentication
```

## Code Quality Standards

### Must Follow Existing Patterns:

1. **File organization:** Match existing structure
2. **Naming conventions:** Follow established patterns
3. **Import statements:** Group and order like existing files
4. **Error handling:** Use same approach as existing code
5. **Validation:** Follow existing validation patterns
6. **Documentation:** Match existing comment style

### Minimize Dependencies:

1. **First choice:** Use @lenne.tech/nest-server capabilities
2. **Second choice:** Use existing project dependencies
3. **Last resort:** Add new packages (with justification)

### Test Quality:

1. **Coverage:** Aim for 80-100% depending on criticality
2. **Clarity:** Tests should be self-documenting
3. **Independence:** Tests should not depend on each other
4. **Repeatability:** Tests should produce consistent results
5. **Speed:** Tests should run reasonably fast

## Autonomous Execution

**You should work autonomously as much as possible:**

1. ✅ Create test files without asking
2. ✅ Run tests without asking
3. ✅ Analyze failures and fix code without asking
4. ✅ Iterate through Steps 3-5 automatically
5. ✅ Use nest-server-generator skill as needed

**Only ask developer when:**

1. ❓ Story has contradictions/ambiguities (Step 1)
2. ❓ Security decorators need to be changed
3. ❓ New npm package needs to be added
4. ❓ Architectural decision with multiple valid approaches
5. ❓ Test keeps failing and you're unsure why

## Final Report

When all tests pass, provide a comprehensive report:

### Report Structure:

```markdown
# Story Implementation Complete ✅

## Story: [Story Name]

### Tests Created
- Location: test/stories/[filename].story.test.ts
- Test cases: [number] scenarios
- Coverage: [coverage percentage if available]

### Implementation Summary
- Modules created/modified: [list]
- Objects created/modified: [list]
- Properties added: [list]
- Other changes: [list]

### Test Results
✅ All [number] tests passing
- [Brief summary of test scenarios]

### Code Quality
- Followed existing patterns: ✅
- Security preserved: ✅
- No new dependencies added: ✅ (or list new dependencies with justification)

### Files Modified
1. [file path] - [what changed]
2. [file path] - [what changed]
...

### Next Steps (if any)
- [Any recommendations or follow-up items]
```

## Common Patterns

### Creating Test Users:

```typescript
// Study existing tests to see the exact pattern used
// Common pattern example:

// Create test user (every logged-in user has the Role.S_USER role)
const resUser = await testHelper.rest('/auth/signin', {
  method: 'POST',
  payload: {
    email: gUserEmail,
    password: gUserPassword,
  },
  statusCode: 201,
});
gUserToken = resUser.token;
await db.collection('users').updateOne({ _id: new ObjectId(resUser.id) }, { $set: { verified: true } });


// Create admin user
const resAdmin = await testHelper.rest('/auth/signin', {
  method: 'POST',
  payload: {
    email: gAdminEmail,
    password: gAdminPassword,
  },
  statusCode: 201,
});
gAdminToken = resAdmin.token;
await db.collection('users').updateOne({ _id: new ObjectId(resAdmin.id) }, { $set: { roles: ['admin'], verified: true } });
```

### Making Authenticated Requests:

```typescript
// Study existing tests for the exact pattern
// Common REST API pattern:
const response = await testHelper.rest('/api/products', {
  method: 'POST',
  payload: input,
  statusCode: 201,
  token: gUserToken,
});

// Common GraphQL pattern:
const result = await testHelper.graphQl(
  {
    arguments: {
      field: value,
    },
    fields: ['id', 'name', { user: ['id', 'email'] }],
    name: 'findProducts',
    type: TestGraphQLType.QUERY,
  },
  { token: gUserToken },
);
```

### Test Organization:

```typescript
describe('Feature Story', () => {
  // Shared setup
  let app: INestApplication;
  let adminUser: User;
  let normalUser: User;

  beforeAll(async () => {
    // Initialize app, database, users
  });

  afterAll(async () => {
    // Cleanup
  });

  describe('Happy Path', () => {
    it('should work for authorized user', async () => {
      // Test
    });
  });

  describe('Error Cases', () => {
    it('should reject unauthorized access', async () => {
      // Test
    });

    it('should validate input data', async () => {
      // Test
    });
  });

  describe('Edge Cases', () => {
    it('should handle special scenarios', async () => {
      // Test
    });
  });
});
```

## Integration with nest-server-generator

**When to invoke nest-server-generator skill:**

During Step 4 (Implementation), you should use the `nest-server-generator` skill for:

1. **Module creation:**
   ```bash
   lt server module ModuleName --no-interactive [options]
   ```

2. **Object creation:**
   ```bash
   lt server object ObjectName [options]
   ```

3. **Adding properties:**
   ```bash
   lt server addProp ModuleName propertyName:type [options]
   ```

4. **Understanding existing code:**
   - Reading and analyzing Services (especially CrudService inheritance)
   - Understanding Controllers and Resolvers
   - Reviewing Models and DTOs

**Best Practice:** Invoke the skill explicitly when you need to create or modify NestJS components, rather than editing files manually.

## Remember

1. **Tests first, code second** - Always write tests before implementation
2. **Iterate until green** - Don't stop until all tests pass
3. **Security is sacred** - Never compromise security for passing tests
4. **Quality over speed** - Take time to write good tests and clean code
5. **Ask when uncertain** - Clarify early to avoid wasted effort
6. **Autonomous execution** - Work independently, report comprehensively
7. **Equivalent implementation** - Match existing patterns and style

Your goal is to deliver fully tested, high-quality features that integrate seamlessly with the existing codebase while maintaining all security standards.