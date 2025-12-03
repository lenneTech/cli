---
name: story-tdd-workflow
version: 1.0.0
description: Complete 7-step TDD workflow with detailed implementation steps, testing guidelines, and validation process
---

# Story-Based TDD Workflow - The Seven Steps

## Table of Contents
- [Step 1: Story Analysis & Validation](#step-1-story-analysis--validation)
- [Step 2: Create Story Test](#step-2-create-story-test)
- [Step 3: Run Tests & Analyze Failures](#step-3-run-tests--analyze-failures)
- [Step 3a: Fix Test Errors (if needed)](#step-3a-fix-test-errors-if-needed)
- [Step 4: Implement/Extend API Code](#step-4-implementextend-api-code)
- [Step 5: Validate & Iterate](#step-5-validate--iterate)
- [Step 5a: Code Quality & Refactoring Check](#step-5a-code-quality--refactoring-check)
- [Step 5b: Final Validation](#step-5b-final-validation)

This skill follows a rigorous 7-step iterative process (with Steps 5, 5a, 5b for final validation and refactoring):

## Step 1: Story Analysis & Validation

**Before writing ANY code or tests:**

1. **Read and analyze the complete user story/requirement**
   - Identify all functional requirements
   - List all acceptance criteria
   - Note any technical constraints

2. **🔍 VERIFY existing API structure - NEVER assume!**
   - **Read actual Controller files** to verify endpoints exist:
     - Check HTTP methods (GET, POST, PUT, DELETE)
     - Verify exact endpoint paths (e.g., `/api/users` vs `/users`)
     - Confirm request/response structures
   - **Read actual Resolver files** for GraphQL:
     - Verify mutation/query names exist
     - Check input types and field names
     - Confirm return types
   - **Read existing test files** to understand patterns:
     - How are endpoints called in practice?
     - What authentication is used?
     - What response structure is expected?
   - **Document what EXISTS vs what NEEDS to be created:**
     - Existing: `/api/products` GET, POST (verified in product.controller.ts:45)
     - Missing: `/api/products/:id/reviews` POST (needs implementation)

3. **Identify contradictions or ambiguities**
   - Look for conflicting requirements
   - Check for unclear specifications
   - Verify if requirements match existing architecture
   - **Verify assumed endpoints actually exist!**

4. **Ask developer for clarification IMMEDIATELY if needed**
   - Don't assume or guess requirements
   - Don't assume endpoints exist without verification
   - Clarify contradictions BEFORE writing tests
   - Get confirmation on architectural decisions
   - Verify security/permission requirements

**⚠️ CRITICAL:** If you find ANY contradictions or ambiguities, STOP and use AskUserQuestion to clarify BEFORE proceeding to Step 2.

**⚠️ CRITICAL:** If you assume an endpoint exists but didn't verify it in the code, you are doing it WRONG! Always read the actual controller/resolver files first.

**Step 1 Checklist:**
- [ ] Story completely read and understood
- [ ] All functional requirements identified
- [ ] All acceptance criteria listed
- [ ] Existing API structure verified (Controllers/Resolvers read)
- [ ] Documented what EXISTS vs what NEEDS creation
- [ ] No contradictions or ambiguities (or clarified with developer)
- [ ] Ready for Step 2

## Step 2: Create Story Test

**🔍 BEFORE Creating New Tests - Check Existing Tests First!**

**CRITICAL:** Before writing ANY new test, verify that the functionality isn't already tested!

1. **Search existing tests** in `tests/` directory:
   - Look for tests covering the same endpoints/mutations
   - Check if existing tests already validate the behavior
   - Identify tests that might need updates due to story changes

2. **If functionality is already tested:**
   - ✅ **DO NOT** create duplicate tests
   - ✅ **Extend** existing tests if new edge cases are needed
   - ✅ **Update** existing tests if the story changes expected behavior

3. **If story changes require modifying existing tests:**
   - ⚠️ **ALWAYS inform the user** about which tests will be modified and why
   - ⚠️ **Only modify tests** when story requirements explicitly change the expected behavior
   - ❌ **NEVER modify tests just because they fail** - failing tests indicate bugs in implementation!

**🚨 CRITICAL RULE: Tests Protect Against Unintended Side Effects!**

```
Test fails after your changes?
    │
    ├─► Does the story EXPLICITLY require this behavior change?
    │   │
    │   ├─► YES (documented in story requirements):
    │   │   └─► ✅ Update the test AND inform the user:
    │   │       "Updating test X because story requires behavior Y"
    │   │
    │   └─► NO (not mentioned in story):
    │       └─► ❌ DO NOT modify the test!
    │           └─► Fix your implementation instead
    │               (you introduced an unintended side effect)
```

**Example - WRONG approach:**
```typescript
// Test fails: "expected status 200, got 401"
// ❌ WRONG: Just change the expected status
expect(response.status).toBe(401); // Changed from 200 to make test pass
```

**Example - CORRECT approach:**
```typescript
// Test fails: "expected status 200, got 401"
// ✅ CORRECT: Investigate WHY it fails
// → Found: Missing authentication token in new implementation
// → Fix: Add proper authentication, keep test expecting 200
```

**When to inform user about test changes:**
- "Modifying `user-registration.story.test.ts` - story now requires email verification before login"
- "Updating expected response in `product-search.test.ts` - story adds new `category` field to response"
- "Adjusting test data in `order-processing.test.ts` - story changes minimum order amount from 10 to 20"

**📖 For detailed guidance on handling failing tests, see: `handling-existing-tests.md`**

---

**🚨 CRITICAL: ALWAYS TEST THROUGH API - NEVER DIRECT SERVICE/DB ACCESS! 🚨**

**FUNDAMENTAL RULE - Read This First:**

Tests MUST go through REST/GraphQL interfaces (Controller/Resolver) using TestHelper. Direct Service or Database access in test logic makes tests WORTHLESS because they bypass the actual API layer that users interact with.

**✅ ALWAYS DO:**
- ✅ Test via REST endpoints: `testHelper.rest('/api/users', { method: 'POST', ... })`
- ✅ Test via GraphQL: `testHelper.graphQl('mutation { createUser(...) }', { ... })`
- ✅ Use TestHelper for ALL functional testing
- ✅ Test the complete chain: Controller/Resolver → Guards → Service → Database

**❌ NEVER DO:**
- ❌ Direct Service calls: `userService.create()` - bypasses authentication!
- ❌ Direct DB queries in tests: `db.collection('users').findOne()` - bypasses business logic!
- ❌ Service instantiation: `new UserService()` - bypasses dependency injection!
- ❌ Mocking Controllers or Resolvers - defeats the purpose!

**Why This Rule Is Absolute:**
- **Security:** Direct Service access bypasses authentication, authorization, guards, decorators
- **Reality:** Tests must verify what actual users experience through the API
- **Business Logic:** Services might have additional validation that gets bypassed
- **Worthless Tests:** Tests that bypass the API cannot catch real bugs

**🔓 RARE Exceptions - Only for Test Setup/Cleanup (NOT for testing functionality):**

Direct database access is ONLY allowed in these specific cases:

**✅ Allowed in beforeAll/beforeEach/afterAll/afterEach:**
- Setting user roles: `await db.collection('users').updateOne({ _id: userId }, { $set: { roles: ['admin'] } })`
- Setting verified status: `await db.collection('users').updateOne({ _id: userId }, { $set: { verified: true } })`
- Cleanup: `await db.collection('products').deleteMany({ createdBy: testUserId })`
- Read-only verification when NO API endpoint exists: `const count = await db.collection('logs').countDocuments()`

**⚠️ Ask Yourself First:**
Before using direct DB/Service access, ask:
1. Can I do this via an API endpoint? → If YES, use the API!
2. Am I testing functionality? → If YES, MUST use API!
3. Is this just setup/cleanup? → Only then consider direct access
4. Am I setting roles/verified status? → Allowed exception
5. Am I reading data that has NO API endpoint? → Allowed, but prefer API

**❌ Still NEVER Allowed - Even in Setup:**
- ❌ Testing functionality via Services
- ❌ Creating test data via Services when API exists
- ❌ Verifying results via DB when API query exists
- ❌ Writing to DB for anything other than roles/verified/cleanup

**Example of correct usage:**

```typescript
describe('User Registration Story', () => {
  let testHelper: TestHelper;
  let db: Db;
  let createdUserId: string;

  beforeAll(async () => {
    testHelper = new TestHelper(app);
    db = app.get<Connection>(getConnectionToken()).db;
  });

  afterAll(async () => {
    // ✅ ALLOWED: Direct DB access for cleanup
    if (createdUserId) {
      await db.collection('users').deleteOne({ _id: new ObjectId(createdUserId) });
    }
  });

  it('should allow new user to register with valid data', async () => {
    // ✅ CORRECT: Test via API
    const result = await testHelper.rest('/auth/signup', {
      method: 'POST',
      payload: {
        email: 'newuser@test.com',
        password: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe'
      },
      statusCode: 201
    });

    expect(result.id).toBeDefined();
    expect(result.email).toBe('newuser@test.com');
    createdUserId = result.id;

    // ✅ ALLOWED: Set verified flag for subsequent tests
    await db.collection('users').updateOne(
      { _id: new ObjectId(createdUserId) },
      { $set: { verified: true } }
    );
  });

  it('should allow verified user to sign in', async () => {
    // ✅ CORRECT: Test via API
    const result = await testHelper.rest('/auth/signin', {
      method: 'POST',
      payload: {
        email: 'newuser@test.com',
        password: 'SecurePass123!'
      },
      statusCode: 201
    });

    expect(result.token).toBeDefined();
    expect(result.user.email).toBe('newuser@test.com');

    // ❌ WRONG: Don't verify via direct DB access
    // const dbUser = await db.collection('users').findOne({ email: 'newuser@test.com' });

    // ✅ CORRECT: Verify via API
    const profile = await testHelper.rest('/api/users/me', {
      method: 'GET',
      token: result.token,
      statusCode: 200
    });
    expect(profile.email).toBe('newuser@test.com');
  });
});
```

---

**🔍 BEFORE Writing Any Tests - Study the TestHelper:**

**CRITICAL: Read the TestHelper source file to understand all available features!**

```
node_modules/@lenne.tech/nest-server/src/test/test.helper.ts
```

This file documents ALL TestHelper capabilities:
- `rest()` and `graphQl()` methods with all options
- File uploads via `attachments` option
- Debugging with `log` and `logError` options in `TestRestOptions`
- Custom headers, status code validation
- Authentication token handling

**Study this file BEFORE writing tests** to avoid reinventing functionality that already exists!

---

**Location:** `tests/stories/` directory (create if it doesn't exist)

**Directory Creation:**
If the `tests/stories/` directory doesn't exist yet, create it first:
```bash
mkdir -p tests/stories
```

**Naming Convention:** `{feature-name}.story.test.ts`
- Example: `user-registration.story.test.ts`
- Example: `product-search.story.test.ts`
- Example: `order-processing.story.test.ts`

**📁 File Organization - Avoid Too Many Files:**

**IMPORTANT:** Before creating a NEW test file, check if existing test files can be extended!

Story tests typically require significant setup (TestHelper, database connections, test users, etc.), so files naturally grow larger. A typical story test file ranges from 400-800 lines, with complex features reaching 1000+ lines.

**✅ PREFER extending existing files when:**
- The new tests relate to the same feature/module
- The existing file is not excessively large (< 1000 lines)
- The tests share similar setup/teardown logic
- It makes logical sense to group them together

**✅ CREATE new files when:**
- Testing a completely different feature/module
- The existing file would exceed ~1000-1200 lines
- The tests require significantly different setup
- It improves clarity and maintainability

**Example:**
```
tests/stories/
  user-authentication.story.test.ts    # Login, logout, password reset, session handling
  user-profile.story.test.ts           # Profile CRUD, settings, preferences
  product-management.story.test.ts     # Product CRUD, variants, pricing
  order-processing.story.test.ts       # Cart, checkout, payment, fulfillment
```

**Why this matters:**
- Too many small files → Hard to navigate, duplicate setup code, redundant boilerplate
- Too few large files → Hard to read, slow to run, merge conflicts
- Balance: Group related tests, split when files grow beyond ~1000 lines

**🔍 BEFORE Writing Tests - Verify Your Assumptions:**

**CRITICAL: Only write tests for endpoints that you have VERIFIED exist in the code!**

1. **For REST endpoints:**
   ```typescript
   // ✅ CORRECT: Verified endpoint exists in user.controller.ts
   await testHelper.rest('/api/users', { method: 'POST', ... });

   // ❌ WRONG: Assumed endpoint without verification
   await testHelper.rest('/api/users/profile', { method: 'PUT', ... });  // Does this exist?
   ```

2. **For GraphQL mutations/queries:**
   ```typescript
   // ✅ CORRECT: Verified 'createUser' mutation exists in user.resolver.ts
   await testHelper.graphQl({ name: 'createUser', type: TestGraphQLType.MUTATION, ... });

   // ❌ WRONG: Assumed mutation without verification
   await testHelper.graphQl({ name: 'updateUserProfile', ... });  // Does this exist?
   ```

3. **Document your verification:**
   ```typescript
   // Test for user creation
   // Verified: POST /api/users exists in src/server/modules/user/user.controller.ts:34
   // Verified: Requires authentication (S_USER role)
   // Verified: Returns User object with id, email, firstName, lastName
   it('should create new user', async () => {
     const result = await testHelper.rest('/api/users', {
       method: 'POST',
       payload: { email: 'test@example.com', ... },
       token: adminToken,
       statusCode: 201
     });
     // ...
   });
   ```

**Test Structure:**

1. **Study existing story tests** (if any exist in `tests/stories/`)
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
  let createdUserIds: string[] = [];
  let createdProductIds: string[] = [];

  // Setup
  beforeAll(async () => {
    // Initialize test environment
  });

  afterAll(async () => {
    // 🧹 CLEANUP: Delete ALL test data created during tests
    // This prevents side effects on subsequent test runs
    if (createdUserIds.length > 0) {
      await db.collection('users').deleteMany({
        _id: { $in: createdUserIds.map(id => new ObjectId(id)) }
      });
    }
    if (createdProductIds.length > 0) {
      await db.collection('products').deleteMany({
        _id: { $in: createdProductIds.map(id => new ObjectId(id)) }
      });
    }
  });

  it('should allow new user to register with valid data', async () => {
    // Test implementation
    const user = await createUser(...);
    createdUserIds.push(user.id); // Track for cleanup
  });

  it('should reject registration with invalid email', async () => {
    // Test implementation
  });

  it('should prevent duplicate email registration', async () => {
    // Test implementation
  });
});
```

**🚨 CRITICAL: Test Data Management for Parallel Execution**

**ALWAYS follow these rules to ensure tests can run in parallel safely!**

Tests run in parallel, so improper test data management causes:
- Conflicts between parallel tests (duplicate keys, race conditions)
- False positives/negatives in tests
- Flaky tests that pass/fail randomly
- Contaminated test database
- Hard-to-debug test failures

**📋 GOLDEN RULES for Test Data:**

1. **Email Addresses Must End with @test.com**
   ```typescript
   // ✅ CORRECT: Will be excluded from external services (e2e.brevo.exclude)
   // Includes timestamp + random suffix for uniqueness even within same millisecond
   const testEmail = `user-${Date.now()}-${Math.random().toString(36).substring(2, 8)}@test.com`;

   // ⚠️ LESS SAFE: Only timestamp (collision risk if tests run in same millisecond)
   const testEmail = `user-${Date.now()}@test.com`;

   // ❌ WRONG: Won't be excluded, may trigger external emails
   const testEmail = 'testuser@example.com';
   ```

   **Why:** Configuration in `src/config.env.ts` uses `e2e.brevo.exclude` to filter out @test.com emails from external services. The random suffix ensures uniqueness even when multiple tests run simultaneously.

2. **NEVER Reuse Same Data Across Test Files**
   ```typescript
   // ❌ WRONG: user-story-1.test.ts and user-story-2.test.ts both use:
   const email = 'admin@test.com';  // ❌ Conflict when running in parallel!

   // ✅ CORRECT: Make data unique per test file with timestamp + random suffix
   const email = `admin-user-story-1-${Date.now()}-${Math.random().toString(36).substring(2, 8)}@test.com`;

   // ⚠️ LESS SAFE: Only timestamp
   const email = `admin-user-story-1-${Date.now()}@test.com`;
   ```

   **Why:** Tests run in parallel. Same email = duplicate key errors and race conditions. Random suffix prevents collisions within same millisecond.

3. **ONLY Delete What You Created in This Test File**
   ```typescript
   // ❌ WRONG: Deletes ALL test users (affects parallel tests)
   await db.collection('users').deleteMany({ email: /@test\.com$/ });

   // ✅ CORRECT: Only delete tracked entities from THIS test
   if (createdUserIds.length > 0) {
     await db.collection('users').deleteMany({
       _id: { $in: createdUserIds.map(id => new ObjectId(id)) }
     });
   }
   ```

   **Why:** Deleting too much breaks parallel tests that are still running.

4. **ALL Created Entities Must Be Cleaned Up**
   ```typescript
   // ✅ Track EVERY entity created
   let createdUserIds: string[] = [];
   let createdProductIds: string[] = [];
   let createdOrderIds: string[] = [];

   // ✅ Clean up ALL in afterAll
   afterAll(async () => {
     if (createdOrderIds.length > 0) {
       await db.collection('orders').deleteMany({
         _id: { $in: createdOrderIds.map(id => new ObjectId(id)) }
       });
     }
     // ... clean up products, users, etc.
   });
   ```

   **Why:** Leftover data causes side effects in future test runs.

5. **NEVER Use Fixed Port Numbers**
   ```typescript
   // ❌ WRONG: Fixed port causes conflicts in parallel tests
   await app.listen(3000);
   const response = await fetch('http://localhost:3000/api/users');

   // ✅ CORRECT: NestJS assigns random ports automatically
   await app.init();  // No port specified
   // Use TestHelper - it handles ports automatically
   const result = await testHelper.rest('/api/users', { ... });
   ```

   **Why:** Parallel tests need different ports. NestJS assigns random available ports automatically. TestHelper abstracts this away.

**Cleanup Strategy:**

1. **Track all created entities:**
   ```typescript
   let createdUserIds: string[] = [];
   let createdProductIds: string[] = [];
   let createdOrderIds: string[] = [];
   ```

2. **Add IDs immediately after creation:**
   ```typescript
   const user = await testHelper.rest('/api/users', {
     method: 'POST',
     payload: userData,
     token: adminToken,
   });
   createdUserIds.push(user.id); // ✅ Track for cleanup
   ```

3. **Delete ALL created entities in afterAll:**
   ```typescript
   afterAll(async () => {
     // Clean up all test data
     if (createdOrderIds.length > 0) {
       await db.collection('orders').deleteMany({
         _id: { $in: createdOrderIds.map(id => new ObjectId(id)) }
       });
     }
     if (createdProductIds.length > 0) {
       await db.collection('products').deleteMany({
         _id: { $in: createdProductIds.map(id => new ObjectId(id)) }
       });
     }
     if (createdUserIds.length > 0) {
       await db.collection('users').deleteMany({
         _id: { $in: createdUserIds.map(id => new ObjectId(id)) }
       });
     }

     await connection.close();
     await app.close();
   });
   ```

4. **Clean up in correct order:**
   - Delete child entities first (e.g., Orders before Products)
   - Delete parent entities last (e.g., Users last)
   - Consider foreign key relationships

5. **Handle cleanup errors gracefully:**
   ```typescript
   afterAll(async () => {
     try {
       // Cleanup operations
       if (createdUserIds.length > 0) {
         await db.collection('users').deleteMany({
           _id: { $in: createdUserIds.map(id => new ObjectId(id)) }
         });
       }
     } catch (error) {
       console.error('Cleanup failed:', error);
       // Don't throw - cleanup failures shouldn't fail the test suite
     }

     await connection.close();
     await app.close();
   });
   ```

**What to clean up:**
- ✅ Users created during tests
- ✅ Products/Resources created during tests
- ✅ Orders/Transactions created during tests
- ✅ Any relationships (comments, reviews, etc.)
- ✅ Files uploaded during tests
- ✅ Any other test data that persists

**What NOT to clean up:**
- ❌ Global test users created in `beforeAll` that are reused (clean these once at the end)
- ❌ Database connections (close these separately)
- ❌ The app instance (close this separately)

**Step 2 Checklist:**
- [ ] Test file created in tests/stories/
- [ ] Endpoints verified before writing tests
- [ ] ALL tests use TestHelper (rest() or graphQl())
- [ ] NO direct Service or DB access in test logic
- [ ] Existing test patterns studied and followed
- [ ] All acceptance criteria covered
- [ ] Cleanup implemented in afterAll
- [ ] All test entities tracked for cleanup
- [ ] Ready for Step 3

## Step 3: Run Tests & Analyze Failures

**Execute all tests:**
```bash
npm test
```

**Or run specific story test:**
```bash
npm test -- tests/stories/your-story.story.test.ts
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

## Step 3a: Fix Test Errors (if needed)

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

## Step 4: Implement/Extend API Code

**Use the `nest-server-generator` skill for implementation:**

1. **Analyze what's needed:**
   - New modules? → Use `nest-server-generator`
   - New objects? → Use `nest-server-generator`
   - New properties? → Use `nest-server-generator`
   - Code modifications? → Use `nest-server-generator`

2. **🔍 Understand existing codebase first - VERIFY before using:**
   - **Read actual Service files** before calling methods:
     - Verify method names and signatures
     - Check required parameters and types
     - Confirm return types
     - Example: Read `user.service.ts` to verify `findById(id: string): Promise<User>` exists
   - **Read actual Model files** to understand data structures:
     - Verify field names and types
     - Check validation rules
     - Confirm relationships
   - **Study @lenne.tech/nest-server patterns** (in `node_modules/@lenne.tech/nest-server/src`):
     - Check CrudService base class for available methods (in `node_modules/@lenne.tech/nest-server/src/core/common/services/crud.service.ts`)
     - Check RoleEnum (in the project or `node_modules/@lenne.tech/nest-server/src/core/common/enums/role.enum.ts`)
     - Understand decorators: @Roles, @Restricted, @UnifiedField
     - Study MapAndValidatePipe for validation logic (automatically activated via CoreModule - see `node_modules/@lenne.tech/nest-server/src/core/common/pipes/map-and-validate.pipe.ts`)
   - **Review existing similar implementations** - don't assume, verify!

   **⚠️ CRITICAL:** Don't assume methods or properties exist - READ THE CODE to verify!

2a. **🚨 CRITICAL: Property Descriptions with German Comments**

   **When user provides German comments/descriptions for properties, you MUST preserve them correctly!**

   **Rule: `ENGLISH (GERMAN)` format**
   - German: `// Produktname` → Description: `'Product name (Produktname)'`
   - German: `// Straße` → Description: `'Street (Straße)'`
   - English: `// Product name` → Description: `'Product name'` (no translation)

   **Process:**
   1. ✅ Extract ALL comments from user requirements (after `//`)
   2. ✅ Translate German to English, keep German in parentheses
   3. ✅ Fix spelling errors but preserve exact wording
   4. ✅ Apply SAME description to: Model, CreateInput, UpdateInput, @ObjectType, @InputType
   5. ❌ NEVER change wording (e.g., `Straße` → `Straßenname` is WRONG!)
   6. ❌ NEVER skip German original in parentheses

   **Example from user requirements:**
   ```
   Module: Product
   - name: string // Produktname
   - price: number // Price
   ```

   **Correct implementation in ALL locations:**
   ```typescript
   // In product.model.ts:
   @UnifiedField({ description: 'Product name (Produktname)' })
   name: string;

   @UnifiedField({ description: 'Price' })
   price: number;

   // In product.input.ts (CreateInput, UpdateInput):
   @UnifiedField({ description: 'Product name (Produktname)' })
   name: string;

   @UnifiedField({ description: 'Price' })
   price: number;
   ```

   **See `nest-server-generator` skill → `description-management.md` for complete details.**

3. **🚨 CRITICAL: ServiceOptions when calling other Services:**

   **NEVER blindly pass all ServiceOptions when one Service calls another!**

   When implementing Service methods that call other Services, analyze which options to pass:

   **❌ WRONG:**
   ```typescript
   // ❌ BAD: Blindly passing all serviceOptions
   const product = await this.productService.findOne({ id: input.productId }, serviceOptions);
   ```

   **✅ CORRECT:**
   ```typescript
   // ✅ GOOD: Only pass what's needed (usually just currentUser)
   const product = await this.productService.findOne(
     { id: input.productId },
     { currentUser: serviceOptions.currentUser }
   );

   // ✅ GOOD: Only set inputType if different Input class is needed
   const user = await this.userService.findOne(
     { id: input.userId },
     {
       currentUser: serviceOptions.currentUser,
       inputType: UserInput // Only if specific Input class needed (e.g., UserInput, UserInputCreate)
     }
   );
   ```

   **Why this matters:**
   - **inputType** specifies which Input class (DTO) to use for validation (e.g., `UserInput`, `UserInputCreate`)
   - The inputType from outer service might be wrong for inner service
   - **roles** might need to be different
   - Other options (limit, skip, etc.) might not apply
   - Can cause incorrect permission checks or wrong validation

   **Before passing options:**
   - Analyze what's in serviceOptions (currentUser, inputType, roles, etc.)
   - Determine what the target Service actually needs
   - Only pass required options (usually just currentUser)
   - Only set inputType if a specific Input class (DTO) is needed (e.g., UserInput, UserInputCreate)

4. **Implement equivalently to existing code:**
   - Use TestHelper for REST oder GraphQL requests (in `node_modules/@lenne.tech/nest-server/src/test/test.helper.ts`)
   - Use `getStringIds()` and `getObjectIds()` from `@lenne.tech/nest-server` for ObjectId conversions
   - Match coding style and patterns
   - Use same architectural approaches
   - Follow established conventions
   - Reuse existing utilities

4a. **🔐 IMPORTANT: Guards in Controllers**

   **DO NOT manually add `@UseGuards(AuthGuard(AuthGuardStrategy.JWT))` - it's automatically activated by `@Roles()`!**

   ```typescript
   // ✅ CORRECT: @Roles automatically activates JWT guard
   @Roles(RoleEnum.ADMIN)
   @Get()
   async findAll() {
     return this.service.find();
   }

   // ✅ CORRECT: @Restricted also activates guards automatically
   @Restricted()
   @Post()
   async create(@Body() input: CreateDto) {
     return this.service.create(input);
   }

   // ❌ WRONG: Redundant manual guard (already included by @Roles)
   @UseGuards(AuthGuard(AuthGuardStrategy.JWT))
   @Roles(RoleEnum.ADMIN)
   @Get()
   async findAll() {
     return this.service.find();
   }
   ```

   **Why this matters:**
   - `@Roles()` decorator automatically applies `@UseGuards(RolesGuard)`
   - `RolesGuard` internally uses JWT authentication
   - Adding `@UseGuards(AuthGuard(...))` manually is redundant and creates duplicate guards
   - Existing controllers don't use manual guards - follow this pattern

5. **🔍 IMPORTANT: Database Indexes**

   **Always define indexes directly in the @UnifiedField decorator via mongoose option!**

   **Quick Guidelines:**
   - Fields used in queries → Add `mongoose: { index: true, type: String }`
   - Foreign keys → Add index
   - Unique fields → Add `mongoose: { index: true, unique: true, type: String }`
   - ⚠️ NEVER define indexes separately in schema files

   **📖 For detailed index patterns and examples, see: `database-indexes.md`**

6. **Prefer existing packages:**
   - Check if @lenne.tech/nest-server provides needed functionality
   - Only add new npm packages as last resort
   - If new package needed, verify:
     - High quality and well-maintained
     - Frequently used (npm downloads)
     - Active maintenance
     - Free license (preferably MIT)
     - Long-term viability

## Step 5: Validate & Iterate

**Run ALL tests:**
```bash
npm test
```

**Check results:**

✅ **All tests pass?**
- Continue to Step 5a (Code Quality Check)

❌ **Some tests still fail?**
- Return to Step 3 (analyze failures)
- Continue iteration

## Step 5a: Code Quality & Refactoring Check

**BEFORE marking the task as complete, perform a code quality review!**

Once all tests are passing, analyze your implementation for code quality issues:

### 1-3. Code Quality Review

**Check for:**
- Code duplication (extract to private methods if used 2+ times)
- Common functionality (create helper functions)
- Similar code paths (consolidate with flexible parameters)
- Consistency with existing patterns

**📖 For detailed refactoring patterns and examples, see: `code-quality.md`**

### 4. Review for Consistency

**Ensure consistent patterns throughout your implementation:**
- Naming conventions match existing codebase
- Error handling follows project patterns
- Return types are consistent
- Similar operations use similar approaches

### 4a. Check Database Indexes

**Verify that indexes are defined where needed:**

**Quick check:**
- Fields used in find/filter → Has index?
- Foreign keys (userId, productId, etc.) → Has index?
- Unique fields (email, username) → Has unique: true?
- Fields used in sorting → Has index?

**If indexes are missing:**
- Add to @UnifiedField decorator (mongoose option)
- Re-run tests
- Document query pattern

**📖 For detailed verification checklist, see: `database-indexes.md`**

### 4b. Security Review

**🔐 CRITICAL: Perform security review before final testing!**

**ALWAYS review all code changes for security vulnerabilities.**

**Quick Security Check:**
- [ ] @Restricted/@Roles decorators NOT removed or weakened
- [ ] Ownership checks in place (users can only access own data)
- [ ] All inputs validated with proper DTOs
- [ ] Sensitive fields marked with hideField: true
- [ ] No injection vulnerabilities
- [ ] Error messages don't expose sensitive data
- [ ] Authorization tests pass

**Red Flags (STOP if found):**
- 🚩 @Restricted decorator removed
- 🚩 @Roles changed to more permissive
- 🚩 Missing ownership checks
- 🚩 Sensitive fields exposed
- 🚩 'any' type instead of DTO

**If ANY red flag found:**
1. STOP implementation
2. Fix security issue immediately
3. Re-run security checklist
4. Update tests to verify security

**📖 For complete security checklist with examples, see: `security-review.md`**

### 5. Refactoring Decision Tree

```
Code duplication detected?
    │
    ├─► Used in 2+ places?
    │   │
    │   ├─► YES: Extract to private method
    │   │   │
    │   │   └─► Used across multiple services?
    │   │       │
    │   │       ├─► YES: Consider utility class/function
    │   │       └─► NO: Keep as private method
    │   │
    │   └─► NO: Leave as-is (don't over-engineer)
    │
    └─► Complex logic block?
        │
        ├─► Hard to understand?
        │   └─► Extract to well-named method
        │
        └─► Simple and clear?
            └─► Leave as-is
```

### 6. Run Tests After Refactoring & Security Review

**CRITICAL: After any refactoring, adding indexes, or security fixes:**

```bash
npm test
```

**Ensure:**
- ✅ All tests still pass
- ✅ No new failures introduced
- ✅ Code is more maintainable
- ✅ No functionality changed
- ✅ Indexes properly applied
- ✅ **Security checks still working (authorization tests pass)**

### 7. When to Skip Refactoring

**Don't refactor if:**
- Code is used in only ONE place
- Extraction would make code harder to understand
- The duplication is coincidental, not conceptual
- Time constraints don't allow for safe refactoring

**Remember:**
- **Working code > Perfect code**
- **Refactor only if it improves maintainability**
- **Always run tests after refactoring**
- **Always add indexes where queries are performed**

## Step 5b: Final Validation

**After refactoring (or deciding not to refactor):**

1. **Run ALL tests one final time:**
   ```bash
   npm test
   ```

2. **Verify:**
   - ✅ All tests pass
   - ✅ Test coverage is adequate
   - ✅ Code follows project patterns
   - ✅ No obvious duplication
   - ✅ Clean and maintainable
   - ✅ **Security review completed**
   - ✅ **No security vulnerabilities introduced**
   - ✅ **Authorization tests pass**

3. **Generate final report for developer**

4. **YOU'RE DONE!** 🎉
