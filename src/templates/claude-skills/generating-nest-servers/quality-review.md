---
name: nest-server-generator-quality-review
version: 1.0.0
description: Comprehensive quality review guidelines before creating final report
---

# Phase 8: Pre-Report Quality Review

## Table of Contents
- [Step 1: Identify All Changes](#step-1-identify-all-changes)
- [Step 2: Test Management](#step-2-test-management)
- [Step 3: Compare with Existing Code](#step-3-compare-with-existing-code)
- [Step 4: Critical Analysis](#step-4-critical-analysis)
- [Step 5: Automated Optimizations](#step-5-automated-optimizations)
- [Step 6: Pre-Report Testing](#step-6-pre-report-testing)
- [Step 7: Final Verification](#step-7-final-verification)

**CRITICAL**: Before creating the final report, you MUST perform a comprehensive quality review:

## Step 1: Identify All Changes

Use git to identify all created and modified files:

```bash
git status --short
git diff --name-only
```

For each file, review:
- All newly created files
- All modified files
- File structure and organization

## Step 2: Test Management

**CRITICAL**: Ensure tests are created/updated for all changes:

### Step 2.1: Analyze Existing Tests FIRST

**BEFORE creating or modifying ANY tests, you MUST thoroughly analyze existing tests**:

1. **Identify all existing test files**:
   ```bash
   # List all test directories and files
   ls -la tests/
   ls -la tests/modules/
   find tests -name "*.e2e-spec.ts" -type f
   ```

2. **Read multiple existing test files completely**:
   ```bash
   # Read at least 2-3 different module tests to understand patterns
   cat tests/modules/user.e2e-spec.ts
   cat tests/modules/<another-module>.e2e-spec.ts

   # Also check the common and project test files
   cat tests/common.e2e-spec.ts
   cat tests/project.e2e-spec.ts
   ```

3. **CRITICAL: Understand the TestHelper thoroughly**:

   **Before creating any tests, you MUST understand the TestHelper from @lenne.tech/nest-server**:

   ```bash
   # Read the TestHelper source code to understand its capabilities
   cat node_modules/@lenne.tech/nest-server/src/test/test.helper.ts
   ```

   **Analyze the TestHelper to understand**:
   - **Available methods**: What methods does TestHelper provide?
   - **Configuration options**: How can TestHelper be configured?
   - **GraphQL support**: How to use `graphQl()` method? What parameters does it accept?
   - **REST support**: How to use `rest()` method? What parameters does it accept?
   - **Authentication**: How does TestHelper handle tokens and authentication?
   - **Request building**: How are requests constructed? What options are available?
   - **Response handling**: How are responses processed? What format is returned?
   - **Error handling**: How does TestHelper handle errors and failures?
   - **Helper utilities**: What additional utilities are available?

   **Document your findings**:
   ```typescript
   // Example: Understanding TestHelper.graphQl()
   // Method signature: graphQl(options: GraphQLOptions, config?: RequestConfig)
   // GraphQLOptions: { name, type (QUERY/MUTATION), arguments, fields }
   // RequestConfig: { token, statusCode, headers }
   // Returns: Parsed response data or error

   // Example: Understanding TestHelper.rest()
   // Method signature: rest(method: HttpMethod, path: string, options?: RestOptions)
   // HttpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
   // RestOptions: { body, token, statusCode, headers }
   // Returns: Response data or error
   ```

   **Common TestHelper patterns to understand**:
   - How to execute GraphQL queries/mutations with `graphQl()`
   - How to execute REST requests with `rest()`
   - How to pass authentication tokens (same for both methods)
   - How to handle expected errors (statusCode parameter)
   - How to work with response data
   - How to structure test data
   - When to use GraphQL vs REST methods

   **Only after fully understanding TestHelper, proceed to next step.**

4. **Understand the testing approach used**:
   - Which test framework? (Jest, Mocha, etc.)
   - Which testing utilities? (@lenne.tech/nest-server testHelper, custom helpers)
   - How is the test app initialized? (beforeAll setup)
   - How are test users/auth handled?
   - How is test data created and cleaned up?
   - What assertion library? (expect, should, etc.)
   - Are there custom matchers?

5. **Document the patterns you observe**:
   - **Import patterns**: Which modules are imported? In what order?
   - **Setup patterns**: How is beforeAll/beforeEach structured?
   - **Auth patterns**: How do tests authenticate? Token handling?
   - **Test structure**: Describe blocks organization? Test naming conventions?
   - **CRUD patterns**: How are create/read/update/delete tested?
   - **Assertion patterns**: What assertions are used? How detailed?
   - **Cleanup patterns**: How is afterAll/afterEach structured?
   - **Error testing**: How are failures/validations tested?

6. **Verify existing tests run successfully**:
   ```bash
   # Run existing tests to ensure they pass
   npm run test:e2e

   # If any fail, understand why before proceeding
   # Your new/modified tests MUST NOT break existing tests
   ```

7. **Create a mental checklist**:
   - [ ] I have read and understand the TestHelper source code
   - [ ] I understand TestHelper methods and configuration
   - [ ] I understand how to use graphQl() method (GraphQL queries/mutations)
   - [ ] I understand how to use rest() method (REST endpoints)
   - [ ] I understand when to use graphQl() vs rest()
   - [ ] I understand TestHelper authentication and error handling
   - [ ] I understand which test helpers/utilities are used
   - [ ] I understand the authentication/authorization pattern
   - [ ] I understand the test data lifecycle (create/cleanup)
   - [ ] I understand the assertion patterns
   - [ ] I understand the error testing approach
   - [ ] All existing tests pass before I make changes

**Only after completing this analysis, proceed to create or modify tests.**

### Step 2.1.1: Understanding Permissions and User Rights in Tests

**CRITICAL**: Before creating tests, you MUST understand the 3-layer permission system:

**Important Definitions**:

- **Admin User**: A user whose `roles` array contains `'admin'`
  ```typescript
  // Example admin user
  {
    id: '123',
    email: 'admin@test.com',
    roles: ['admin', 'user'] // ← Contains 'admin'
  }
  ```

- **Creator**: The user who created an object, identified by matching IDs
  ```typescript
  // User who created the object
  const user = { id: 'user-123', email: 'creator@test.com' };

  // Object created by this user
  const product = {
    id: 'product-456',
    name: 'Test Product',
    createdBy: 'user-123' // ← Matches user.id → This user is the CREATOR
  };

  // Different user (NOT the creator)
  const otherUser = { id: 'user-789', email: 'other@test.com' };
  // otherUser.id !== product.createdBy → NOT the creator!
  ```

**The Three Permission Layers**:

1. **Controller/Resolver Layer** (`@Roles()` decorator):
   - Controls WHO can call the endpoint
   - Example: `@Roles(RoleEnum.ADMIN)` → Only admins can call this endpoint
   - Example: `@Roles(RoleEnum.S_USER)` → All signed-in users can call

2. **Service Layer** (`serviceOptions.roles` parameter):
   - Controls what permissions are checked during service processing
   - Example: Update/Delete often require `[RoleEnum.ADMIN, RoleEnum.S_CREATOR]`
   - The creator can update/delete their own items

3. **Model Layer** (`securityCheck()` method):
   - Controls WHAT data is returned to the user
   - Standard implementation:
     ```typescript
     securityCheck(user: User, force?: boolean) {
       // Admins see everything (user.roles contains 'admin')
       if (force || user?.hasRole(RoleEnum.ADMIN)) {
         return this;
       }
       // Only creator can see their own data (user.id === this.createdBy)
       if (!equalIds(user, this.createdBy)) {
         return undefined; // Non-creator gets nothing!
       }
       return this;
     }
     ```
   - **Key checks**:
     - `user?.hasRole(RoleEnum.ADMIN)` → Returns `true` if `user.roles.includes('admin')`
     - `equalIds(user, this.createdBy)` → Returns `true` if `user.id === this.createdBy`

**Default Permission Behavior**:
- **Create**: Usually accessible to signed-in users (`RoleEnum.S_USER`)
- **Read/List**: Usually accessible to signed-in users, but securityCheck filters results
- **Update**: Only ADMIN or CREATOR (via `serviceOptions.roles` check)
- **Delete**: Only ADMIN or CREATOR (via `serviceOptions.roles` check)

**Analyzing Permissions Before Creating Tests**:

Before writing tests, check these 3 locations:

1. **Check Controller/Resolver decorators**:
   ```typescript
   // In product.resolver.ts
   @Roles(RoleEnum.ADMIN) // ← WHO can call this?
   @Query(() => Product)
   async getProduct(@Args('id') id: string) { ... }

   @Roles(RoleEnum.S_USER) // ← All signed-in users
   @Mutation(() => Product)
   async createProduct(@Args('input') input: ProductCreateInput) { ... }
   ```

2. **Check Model/Object `@Restricted` decorators**:
   ```typescript
   // In product.model.ts
   @Restricted(RoleEnum.ADMIN) // ← Model-level restriction
   export class Product extends CoreModel {

     @Restricted(RoleEnum.ADMIN) // ← Property-level restriction
     @UnifiedField()
     internalNotes?: string;
   }
   ```

3. **Check Model `securityCheck()` logic**:
   ```typescript
   // In product.model.ts
   securityCheck(user: User, force?: boolean) {
     // Admin check: user.roles contains 'admin'
     if (force || user?.hasRole(RoleEnum.ADMIN)) {
       return this; // Admin sees all
     }

     // Custom logic: Allow public products for everyone
     if (this.isPublic) {
       return this;
     }

     // Creator check: user.id === this.createdBy
     if (!equalIds(user, this.createdBy)) {
       return undefined; // Non-creator gets nothing
     }
     return this; // Creator sees their own product
   }
   ```

**Creating Appropriate Test Users**:

Based on permission analysis, create appropriate test users:

```typescript
describe('Product Module', () => {
  let testHelper: TestHelper;
  let adminToken: string;
  let userToken: string;
  let otherUserToken: string;
  let createdProductId: string;

  beforeAll(async () => {
    testHelper = new TestHelper(app);

    // Admin user (user.roles contains 'admin')
    const adminAuth = await testHelper.graphQl({
      name: 'signIn',
      type: TestGraphQLType.MUTATION,
      arguments: { email: 'admin@test.com', password: 'admin' },
      fields: ['token', 'user { id email roles }']
    });
    adminToken = adminAuth.token;
    // adminAuth.user.roles = ['admin', 'user'] ← Contains 'admin'

    // Regular user (will be the creator of test objects)
    const userAuth = await testHelper.graphQl({
      name: 'signIn',
      type: TestGraphQLType.MUTATION,
      arguments: { email: 'user@test.com', password: 'user' },
      fields: ['token', 'user { id email roles }']
    });
    userToken = userAuth.token;
    // When this user creates an object → object.createdBy = userAuth.user.id

    // Another regular user (will NOT be the creator)
    const otherUserAuth = await testHelper.graphQl({
      name: 'signIn',
      type: TestGraphQLType.MUTATION,
      arguments: { email: 'other@test.com', password: 'other' },
      fields: ['token', 'user { id email roles }']
    });
    otherUserToken = otherUserAuth.token;
    // otherUserAuth.user.id !== object.createdBy → NOT the creator
  });
});
```

**Test Structure Based on Permissions**:

```typescript
describe('Product Module', () => {
  // ... setup with adminToken, userToken, otherUserToken

  describe('Create Product', () => {
    it('should create product as regular user', async () => {
      const result = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: { name: 'Test Product', price: 99.99 } },
        fields: ['id', 'name', 'createdBy { id }']
      }, { token: userToken }); // ← Created by userToken

      expect(result.name).toBe('Test Product');
      // result.createdBy.id now equals userAuth.user.id
      // → userToken is the CREATOR of this product
      createdProductId = result.id;
    });
  });

  describe('Update Product', () => {
    it('should update product as creator', async () => {
      const result = await testHelper.graphQl({
        name: 'updateProduct',
        type: TestGraphQLType.MUTATION,
        arguments: {
          id: createdProductId,
          input: { price: 89.99 }
        },
        fields: ['id', 'price']
      }, { token: userToken }); // ← Creator: userAuth.user.id === product.createdBy

      expect(result.price).toBe(89.99);
    });

    it('should update product as admin', async () => {
      const result = await testHelper.graphQl({
        name: 'updateProduct',
        type: TestGraphQLType.MUTATION,
        arguments: {
          id: createdProductId,
          input: { price: 79.99 }
        },
        fields: ['id', 'price']
      }, { token: adminToken }); // ← Admin: adminAuth.user.roles contains 'admin'

      expect(result.price).toBe(79.99);
    });

    it('should fail to update product as non-creator', async () => {
      const result = await testHelper.graphQl({
        name: 'updateProduct',
        type: TestGraphQLType.MUTATION,
        arguments: {
          id: createdProductId,
          input: { price: 69.99 }
        },
        fields: ['id']
      }, { token: otherUserToken, statusCode: 403 }); // ← Not creator: otherUserAuth.user.id !== product.createdBy

      expect(result.errors).toBeDefined();
    });
  });

  describe('Delete Product', () => {
    it('should delete product as creator', async () => {
      // First create a new product to delete
      const created = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: { name: 'To Delete', price: 50 } },
        fields: ['id']
      }, { token: userToken });

      // Delete as creator
      const result = await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: created.id },
        fields: ['id']
      }, { token: userToken }); // ← Creator: userAuth.user.id === created.createdBy

      expect(result.id).toBe(created.id);
    });

    it('should fail to delete product as non-creator', async () => {
      const result = await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdProductId },
        fields: ['id']
      }, { token: otherUserToken, statusCode: 403 }); // ← Not creator: otherUserAuth.user.id !== product.createdBy

      expect(result.errors).toBeDefined();
    });

    it('should delete any product as admin', async () => {
      const result = await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdProductId },
        fields: ['id']
      }, { token: adminToken }); // ← Admin: adminAuth.user.roles contains 'admin'

      expect(result.id).toBe(createdProductId);
    });
  });
});
```

**Permission Testing Checklist**:

Before creating tests, verify:

- [ ] I have checked the `@Roles()` decorators in controllers/resolvers
- [ ] I have checked the `@Restricted()` decorators in models/objects
- [ ] I have reviewed the `securityCheck()` logic in models
- [ ] I understand who can CREATE items (usually S_USER)
- [ ] I understand who can READ items (S_USER + securityCheck filtering)
- [ ] I understand who can UPDATE items (usually ADMIN + S_CREATOR)
- [ ] I understand who can DELETE items (usually ADMIN + S_CREATOR)
- [ ] I have created appropriate test users (admin, creator, non-creator)
- [ ] My tests use the CREATOR token (user.id === object.createdBy) for update/delete operations
- [ ] My tests verify that non-creators (user.id !== object.createdBy) CANNOT update/delete
- [ ] My tests verify that admins (user.roles contains 'admin') CAN update/delete everything

**Common Permission Test Patterns**:

1. **Test with creator** (user.id === object.createdBy) → Should succeed
2. **Test with admin** (user.roles contains 'admin') → Should succeed
3. **Test with other user** (user.id !== object.createdBy) → Should fail (403)

**Only after understanding permissions, proceed to create tests.**

### Step 2.2: For Newly Created Modules

**CRITICAL: Follow the correct test folder structure**:

The project uses a specific test organization:

1. **Module tests** (for modules in `src/server/modules/`):
   ```
   tests/modules/<module-name>.e2e-spec.ts
   ```
   - Each module gets its own test file directly in `tests/modules/`
   - Examples: `tests/modules/user.e2e-spec.ts`, `tests/modules/book.e2e-spec.ts`

2. **Common tests** (for common functionality in `src/server/common/`):
   ```
   tests/common.e2e-spec.ts
   ```
   - All common functionality (enums, objects, helpers) tested here
   - Single file for all common-related tests

3. **Project tests** (for everything else - root level, config, etc.):
   ```
   tests/project.e2e-spec.ts
   ```
   - General project-level tests
   - Configuration tests
   - Integration tests

**Determine correct test location**:

```bash
# BEFORE creating a test, ask yourself:
# - Is this a module in src/server/modules/? → tests/modules/<name>.e2e-spec.ts
# - Is this common functionality? → Add to tests/common.e2e-spec.ts
# - Is this project-level? → Add to tests/project.e2e-spec.ts

# Check existing test structure to confirm:
ls -la tests/
ls tests/modules/
```

**Create new test files** for modules following the patterns you identified:

```bash
# For a new module (e.g., Book)
tests/modules/book.e2e-spec.ts
```

**IMPORTANT**: Your new test file MUST:
1. **Match the exact structure** of existing test files
2. **Use the same imports** as existing tests
3. **Follow the same setup/cleanup pattern** (beforeAll, afterAll)
4. **Use the same test helpers/utilities** you observed
5. **Follow the same authentication pattern**
6. **Use the same assertion style**
7. **Follow the same naming conventions** for describe/it blocks

**Each new test file must include**:
1. All CRUD operations (create, find all, find by ID, update, delete)
2. Authorization tests (unauthorized should fail, authorized should succeed)
3. Required field validation (missing required fields should fail)
4. Proper test data setup and cleanup (beforeAll, afterAll)
5. Tests for any custom methods or relationships

**Ensure all prerequisites are met by analyzing existing tests**:

Before writing test code, identify ALL prerequisites from existing test files:

```bash
# Read an existing module test to understand prerequisites
cat tests/modules/user.e2e-spec.ts
```

**Common prerequisites to check**:
1. **Test data dependencies**:
   - Does the module reference other modules? (e.g., Book → User for borrowedBy)
   - Do you need to create related test data first?
   - Example: To test Book with borrowedBy: User, create test User first

2. **Authentication requirements**:
   - What roles/permissions are needed?
   - Do test users need to be created with specific roles?
   - Example: Admin user for create operations, regular user for read operations

3. **Database setup**:
   - Are there database constraints or required collections?
   - Do embedded objects or enums need to exist?

4. **Configuration**:
   - Are environment variables or config values needed?
   - Example: JWT secrets, database connections

**Pattern from existing tests**:
```typescript
// Example structure you should follow:
beforeAll(async () => {
  // 1. Initialize test app/module
  // 2. Set up database connection
  // 3. Create prerequisite test data (users, roles, etc.)
  // 4. Authenticate and get tokens
});

describe('Module Tests', () => {
  // Tests here
});

afterAll(async () => {
  // 1. Delete created test data (in reverse order)
  // 2. Clean up connections
  // 3. Close app
});
```

**CRITICAL**: Look at how existing tests handle prerequisites and replicate the exact same approach.

### Step 2.3: For Modified Existing Modules

**Update existing test files** when you modify modules:

1. **FIRST: Read the existing test file completely**:
   ```bash
   # Find and read the test file for the module you modified
   find tests -name "*<module-name>*.e2e-spec.ts"
   cat tests/modules/<module-name>.e2e-spec.ts
   ```

2. **Understand what the existing tests cover**:
   - Which operations are tested?
   - Which properties are validated?
   - What edge cases are covered?
   - How is test data structured?

3. **Run existing tests to ensure they pass BEFORE your changes**:
   ```bash
   npm run test:e2e
   ```

4. **Review and update tests**:
   - **Added properties**: Add tests verifying new properties work correctly
   - **Changed validation**: Update tests to reflect new validation rules
   - **Added relationships**: Add tests for new references/embedded objects
   - **Changed required fields**: Update CreateInput tests accordingly
   - **Removed properties**: Remove related test assertions

5. **Verify test coverage**:
   - All new properties are tested
   - Changed behavior is verified
   - Edge cases are covered
   - Authorization still works correctly

6. **Run tests again to ensure your changes don't break anything**:
   ```bash
   npm run test:e2e
   ```

## Step 3: Compare with Existing Code

**Compare generated code with existing project code**:

1. **Read existing similar modules** to understand project patterns:
   ```bash
   # Example: If you created a User module, check existing modules
   ls src/server/modules/
   ```

2. **Check for consistency**:
   - Code style (indentation, spacing, formatting)
   - Import ordering and organization
   - Naming conventions (camelCase, PascalCase, kebab-case)
   - File structure and directory organization
   - Comment style and documentation
   - Decorator usage (@Field, @Prop, etc.)
   - Error handling patterns
   - Validation patterns

3. **Review property ordering**:
   - Verify alphabetical order in models
   - Verify alphabetical order in inputs
   - Verify alphabetical order in outputs
   - Check decorator consistency

## Step 4: Critical Analysis

**Analyze each file critically**:

1. **Style consistency**:
   - Does the code match the project's existing style?
   - Are imports grouped and ordered correctly?
   - Is indentation consistent with the project?
   - Are naming conventions followed?

2. **Structural consistency**:
   - Are decorators in the same order as existing code?
   - Is the file structure identical to existing modules?
   - Are descriptions formatted the same way?
   - Are relationships implemented consistently?

3. **Code quality**:
   - Are there any redundant imports?
   - Are there any missing imports?
   - Are descriptions meaningful and complete?
   - Are TypeScript types correctly used?

4. **Best practices**:
   - Are required fields properly marked?
   - Are nullable fields correctly configured?
   - Are references properly typed?
   - Are arrays correctly configured?

## Step 5: Automated Optimizations

**Apply automatic improvements**:

1. **Fix import ordering**:
   - External imports first (alphabetically)
   - @lenne.tech/nest-server imports next
   - Local imports last (alphabetically by path depth)

2. **Fix property ordering**:
   - Reorder all properties alphabetically in models
   - Reorder all properties alphabetically in inputs
   - Reorder all properties alphabetically in outputs

3. **Fix formatting**:
   - Ensure consistent indentation
   - Remove extra blank lines
   - Add missing blank lines between sections

4. **Fix descriptions**:
   - Ensure all follow "ENGLISH (DEUTSCH)" format
   - Add missing descriptions
   - Improve unclear descriptions

5. **Fix common patterns**:
   - Standardize decorator usage
   - Standardize validation patterns
   - Standardize error handling

## Step 6: Pre-Report Testing

**MANDATORY**: Run all tests before reporting:

```bash
# Run TypeScript compilation
npm run build

# Run linting
npm run lint

# Run all tests
npm run test:e2e

# If any fail, fix issues and repeat
```

**If tests fail**:
1. Analyze the error
2. Fix the issue
3. Re-run tests
4. Repeat until all tests pass

### Debugging Failed Tests - Important Guidelines

**When tests fail, use systematic debugging with console.log statements:**

1. **Add debug messages in Controllers/Resolvers**:
   ```typescript
   // In controller/resolver - BEFORE service call
   console.log('🔵 [Controller] createProduct - Input:', input);
   console.log('🔵 [Controller] createProduct - User:', serviceOptions?.user);

   const result = await this.productService.create(input, serviceOptions);

   // AFTER service call
   console.log('🔵 [Controller] createProduct - Result:', result);
   ```

2. **Add debug messages in Services**:
   ```typescript
   // In service method
   console.log('🟢 [Service] create - Input:', input);
   console.log('🟢 [Service] create - ServiceOptions:', serviceOptions);

   const created = await super.create(input, serviceOptions);

   console.log('🟢 [Service] create - Created:', created);
   ```

3. **Understand the permissions system**:
   - **Controllers/Resolvers**: `@Roles()` decorator controls WHO can call the endpoint
   - **Services**: `serviceOptions.roles` controls what the service checks during processing
   - **Models**: `securityCheck()` method determines what data is returned to the user

4. **Default permission behavior**:
   - Only **Admin users** (user.roles contains 'admin') OR the **creator** (user.id === object.createdBy) of an element can access it
   - This is enforced in the `securityCheck()` method in models:
   ```typescript
   securityCheck(user: User, force?: boolean) {
     // Admin: user.roles contains 'admin'
     if (force || user?.hasRole(RoleEnum.ADMIN)) {
       return this; // Admin sees everything
     }
     // Creator: user.id === this.createdBy
     if (!equalIds(user, this.createdBy)) {
       return undefined; // Non-creator (user.id !== this.createdBy) gets nothing
     }
     return this; // Creator sees their own data
   }
   ```

5. **Debugging strategy for permission issues**:

   **Step 1**: Run failing test with Admin user first
   ```typescript
   // In test setup
   const adminToken = await testHelper.signIn('admin@test.com', 'admin-password');

   // Use admin token in test
   const result = await testHelper.graphQl({...}, { token: adminToken });
   ```

   **Step 2**: Analyze results
   - ✅ **Works with Admin, fails with normal user** → Permission issue (check Roles, securityCheck)
   - ❌ **Fails with Admin too** → Different issue (check logic, data, validation)

6. **Common permission issues and solutions**:

   | Problem | Cause | Solution |
   |---------|-------|----------|
   | 401/403 on endpoint | `@Roles()` too restrictive | Adjust decorator in controller/resolver |
   | Empty result despite data existing | `securityCheck()` returns undefined | Modify securityCheck logic or use Admin |
   | Service throws permission error | `serviceOptions.roles` check fails | Pass correct roles in serviceOptions |

7. **Remove debug messages after fixing**:
   ```bash
   # After tests pass, remove all console.log statements
   # Search for debug patterns
   grep -r "console.log" src/server/modules/your-module/

   # Remove them manually or with sed
   # Then verify tests still pass
   npm run test:e2e
   ```

**Debugging workflow example**:
```typescript
// 1. Test fails - add debugging
@Mutation(() => Product)
async createProduct(@Args('input') input: ProductCreateInput, @GraphQLServiceOptions() opts) {
  console.log('🔵 START createProduct', { input, user: opts?.user?.email });

  const result = await this.productService.create(input, opts);

  console.log('🔵 END createProduct', { result: result?.id });
  return result;
}

// In service
async create(input: ProductCreateInput, serviceOptions?: ServiceOptions) {
  console.log('🟢 Service create', { input, user: serviceOptions?.user?.email });

  const created = await super.create(input, serviceOptions);

  console.log('🟢 Service created', { id: created?.id, createdBy: created?.createdBy });
  return created;
}

// 2. Run test - observe output:
// 🔵 START createProduct { input: {...}, user: 'test@test.com' }
// 🟢 Service create { input: {...}, user: 'test@test.com' }
// 🟢 Service created { id: '123', createdBy: '456' }
// 🔵 END createProduct { result: undefined }  ← AHA! Result is undefined!

// 3. Check model securityCheck() - likely returns undefined for non-creator (user.id !== object.createdBy)
// 4. Fix: Either use Admin user (user.roles contains 'admin') or adjust securityCheck logic
// 5. Test passes → Remove console.log statements
// 6. Verify tests still pass
```

**Do not proceed to final report if**:
- TypeScript compilation fails
- Linting fails
- Any tests fail
- Console shows errors or warnings

## Step 7: Final Verification

Before reporting, verify:

- [ ] All files compared with existing code
- [ ] Code style matches project patterns
- [ ] All imports properly ordered
- [ ] All properties in alphabetical order
- [ ] All descriptions follow format
- [ ] **TestHelper source code read and understood**
- [ ] **TestHelper methods and configuration understood**
- [ ] **Existing tests analyzed BEFORE creating/modifying tests**
- [ ] **Existing tests passed BEFORE making changes**
- [ ] **Tests in correct location (tests/modules/<name>.e2e-spec.ts, tests/common.e2e-spec.ts, or tests/project.e2e-spec.ts)**
- [ ] **New test files created for all new modules**
- [ ] **Existing test files updated for all modified modules**
- [ ] **All prerequisites identified and handled (test data dependencies, auth, etc.)**
- [ ] **All new/modified tests follow exact patterns from existing tests**
- [ ] TypeScript compiles without errors
- [ ] Linter passes without warnings
- [ ] **All tests pass AFTER changes**
- [ ] No console errors or warnings

**Only after ALL checks pass, proceed to Final Report.**
