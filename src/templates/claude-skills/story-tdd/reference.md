---
name: story-tdd-reference
version: 1.0.0
description: Quick reference guide for Test-Driven Development workflow
---

# Story-Based TDD Quick Reference

## The 7-Step Workflow

```
┌─────────────────────────────────────────────────────────┐
│ Step 1: Analyze Story & Clarify                         │
│ - Read requirements thoroughly                          │
│ - Check existing API structure                          │
│ - Identify contradictions                               │
│ - ASK DEVELOPER if anything unclear                     │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Step 2: Create Story Test                               │
│ - Location: test/stories/feature-name.story.test.ts     │
│ - Study existing test patterns                          │
│ - Write comprehensive test scenarios                    │
│ - Cover happy path, errors, edge cases                  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Step 3: Run Tests & Analyze                             │
│ - npm test                                              │
│ - Record failures and reasons                           │
│ - Decide: Test bug OR Missing implementation            │
└─────────────────────────────────────────────────────────┘
                          ↓
                   ┌──────┴──────┐
                   │             │
        ┌──────────▼─┐       ┌───▼────────────┐
        │ Step 3a:   │       │ Step 4:        │
        │ Fix Test   │       │ Implement Code │
        │ Errors     │       │ (Use nest-     │
        │            │       │  server-       │
        │            │       │  generator)    │
        └──────┬─────┘       └───┬────────────┘
               │                 │
               └────────┬────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Step 5: Validate                                        │
│ - Run ALL tests                                         │
│ - All pass? → Go to Step 5a                            │
│ - Some fail? → Back to Step 3                          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Step 5a: Code Quality, Security & Refactoring Check    │
│ - Check for code duplication                            │
│ - Extract common functionality                          │
│ - Consolidate similar code paths                        │
│ - Review for consistency                                │
│ - Check database indexes                                │
│ - 🔐 SECURITY REVIEW (CRITICAL)                         │
│ - Run tests after refactoring                           │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Step 5b: Final Validation                               │
│ - Run ALL tests one final time                          │
│ - Generate report → DONE! 🎉                            │
└─────────────────────────────────────────────────────────┘
```

## Commands Cheatsheet

### Running Tests

```bash
# Run all tests
npm test

# Run specific story test
npm test -- test/stories/feature-name.story.test.ts

# Run tests with coverage
npm run test:cov

# Run tests in watch mode
npm run test:watch
```

### Using nest-server-generator Skill

```bash
# Create module
lt server module ModuleName --no-interactive

# Create object
lt server object ObjectName --no-interactive

# Add property
lt server addProp ModuleName propertyName:type --no-interactive

# Examples:
lt server module Review --no-interactive
lt server addProp Review rating:number --no-interactive
lt server addProp Review comment:string? --no-interactive
```

## Test File Template

```typescript
import {
  ConfigService,
  HttpExceptionLogFilter,
  TestGraphQLType,
  TestHelper,
} from '@lenne.tech/nest-server';
import { Test, TestingModule } from '@nestjs/testing';
import { PubSub } from 'graphql-subscriptions';
import { MongoClient } from 'mongodb';

import envConfig from '../../src/config.env';
import { RoleEnum } from '../../src/server/common/enums/role.enum';
import { YourService } from '../../src/server/modules/your-module/your.service';
import { imports, ServerModule } from '../../src/server/server.module';

describe('[Feature Name] Story', () => {
  // Test environment properties
  let app;
  let testHelper: TestHelper;

  // Database
  let connection;
  let db;

  // Services
  let yourService: YourService;

  // Global test data
  let gUserToken: string;
  let gUserId: string;

  // Track created entities for cleanup
  let createdEntityIds: string[] = [];

  beforeAll(async () => {
    // Start server for testing
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [...imports, ServerModule],
      providers: [
        YourService,
        {
          provide: 'PUB_SUB',
          useValue: new PubSub(),
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new HttpExceptionLogFilter());
    app.setBaseViewsDir(envConfig.templates.path);
    app.setViewEngine(envConfig.templates.engine);
    await app.init();

    testHelper = new TestHelper(app);
    yourService = moduleFixture.get(YourService);

    // Connection to database
    connection = await MongoClient.connect(envConfig.mongoose.uri);
    db = await connection.db();

    // Create test user
    const password = Math.random().toString(36).substring(7);
    const email = `test-${password}@example.com`;
    const signUp = await testHelper.graphQl({
      arguments: {
        input: {
          email,
          firstName: 'Test',
          password,
        },
      },
      fields: ['token', { user: ['id', 'email'] }],
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
    });
    gUserId = signUp.user.id;
    gUserToken = signUp.token;
  });

  afterAll(async () => {
    // 🧹 CLEANUP: Delete all test data created during tests
    try {
      if (createdEntityIds.length > 0) {
        await db.collection('entities').deleteMany({
          _id: { $in: createdEntityIds.map(id => new ObjectId(id)) }
        });
      }

      // Delete test user
      if (gUserId) {
        await db.collection('users').deleteOne({ _id: new ObjectId(gUserId) });
      }
    } catch (error) {
      console.error('Cleanup failed:', error);
    }

    await connection.close();
    await app.close();
  });

  describe('Happy Path', () => {
    it('should [expected behavior]', async () => {
      // Arrange
      const data = { /* test data */ };

      // Act - Using REST
      const result = await testHelper.rest('/api/endpoint', {
        method: 'POST',
        payload: data,
        token: gUserToken,
      });

      // Assert
      expect(result).toMatchObject({
        // expected properties
      });

      // Track for cleanup
      createdEntityIds.push(result.id);
    });
  });

  describe('Error Cases', () => {
    it('should reject invalid input', async () => {
      await testHelper.rest('/api/endpoint', {
        method: 'POST',
        payload: { /* invalid data */ },
        statusCode: 400,
        token: gUserToken,
      });
    });

    it('should require authentication', async () => {
      await testHelper.rest('/api/endpoint', {
        method: 'POST',
        payload: { /* data */ },
        statusCode: 401,
      });
    });
  });
});
```

## Database Indexes with @UnifiedField

### When to Add Indexes

**🔍 ALWAYS define indexes in @UnifiedField decorator via mongoose option!**

```typescript
// ✅ CORRECT: Index in decorator mongoose option
@UnifiedField({
  description: 'User email',
  mongoose: { index: true, unique: true, type: String }
})
email: string;

// ❌ WRONG: Separate schema index (hard to find)
UserSchema.index({ email: 1 }, { unique: true });
```

### Common Index Patterns

**Single Field Index:**
```typescript
@UnifiedField({
  description: 'Product category',
  mongoose: { index: true, type: String }  // For queries like: find({ category: 'electronics' })
})
category: string;
```

**Unique Index:**
```typescript
@UnifiedField({
  description: 'Username',
  mongoose: { index: true, unique: true, type: String }  // Prevents duplicates
})
username: string;
```

**Foreign Key Index:**
```typescript
@UnifiedField({
  description: 'User who created this',
  mongoose: { index: true, type: String }  // For JOIN/population operations
})
createdBy: string;
```

**Multiple Indexed Fields:**
```typescript
@UnifiedField({
  description: 'Customer reference',
  mongoose: { index: true, type: String }  // Indexed individually
})
customerId: string;

@UnifiedField({
  description: 'Order status',
  mongoose: { index: true, type: String }  // Indexed individually
})
status: string;

// Both indexed for flexible querying
```

**Text Search Index:**
```typescript
@UnifiedField({
  description: 'Product name',
  mongoose: { type: String, text: true }  // For full-text search
})
name: string;
```

### Index Checklist

Before marking complete, verify:

- [ ] Fields used in `find()` queries have indexes
- [ ] Foreign keys (userId, productId, etc.) have indexes
- [ ] Unique fields (email, username) marked with `unique: true`
- [ ] Fields used in sorting have indexes
- [ ] Compound queries use compound indexes
- [ ] All indexes in @UnifiedField decorator (NOT separate schema)

## REST API Testing Patterns (using TestHelper)

```typescript
// GET request
const result = await testHelper.rest('/api/resource/123', {
  token: userToken,
});

// GET request (public endpoint, no auth)
const result = await testHelper.rest('/api/public');

// POST request
const result = await testHelper.rest('/api/resource', {
  method: 'POST',
  payload: data,
  token: userToken,
});

// PUT request
const result = await testHelper.rest('/api/resource/123', {
  method: 'PUT',
  payload: updates,
  token: userToken,
});

// DELETE request
const result = await testHelper.rest('/api/resource/123', {
  method: 'DELETE',
  token: userToken,
});

// Expect specific status code
await testHelper.rest('/api/resource', {
  method: 'POST',
  payload: invalidData,
  statusCode: 400,
  token: userToken,
});

// With custom headers
const result = await testHelper.rest('/api/resource', {
  headers: {
    'Content-Type': 'application/json',
    'X-Custom-Header': 'value',
  },
  token: userToken,
});
```

## GraphQL Testing Patterns (using TestHelper)

```typescript
import { TestGraphQLType, TestHelper } from '@lenne.tech/nest-server';

// GraphQL Query
const user = await testHelper.graphQl({
  arguments: {
    id: userId,
  },
  fields: ['id', 'email', 'firstName', { profile: ['bio', 'avatar'] }],
  name: 'getUser',
  type: TestGraphQLType.QUERY,
}, { token: userToken });

expect(user).toMatchObject({
  id: userId,
  email: 'test@example.com',
});

// GraphQL Mutation
const result = await testHelper.graphQl({
  arguments: {
    input: {
      firstName: 'Updated',
      lastName: 'Name',
    },
  },
  fields: ['id', 'firstName', 'lastName'],
  name: 'updateUser',
  type: TestGraphQLType.MUTATION,
}, { token: userToken });

// GraphQL Mutation with nested objects
const created = await testHelper.graphQl({
  arguments: {
    input: {
      title: 'New Post',
      content: 'Post content',
      tags: ['tag1', 'tag2'],
    },
  },
  fields: ['id', 'title', { author: ['id', 'email'] }, 'tags'],
  name: 'createPost',
  type: TestGraphQLType.MUTATION,
}, { token: userToken });

// GraphQL Query without auth (public)
const publicData = await testHelper.graphQl({
  arguments: {},
  fields: ['version', 'status'],
  name: 'getPublicInfo',
  type: TestGraphQLType.QUERY,
});

// Expecting errors (e.g., unauthorized)
const result = await testHelper.graphQl({
  arguments: { id: otherUserId },
  fields: ['id', 'email'],
  name: 'getUser',
  type: TestGraphQLType.QUERY,
}, { token: userToken, statusCode: 200 });

expect(result.errors).toBeDefined();
expect(result.errors[0].message).toContain('Forbidden');
```

## Common Test Assertions

```typescript
// Object matching
expect(result).toMatchObject({ key: value });

// Exact equality
expect(result).toEqual(expected);

// Array checks
expect(array).toHaveLength(3);
expect(array).toContain(item);
expect(array).toBeInstanceOf(Array);

// Existence checks
expect(value).toBeDefined();
expect(value).toBeUndefined();
expect(value).toBeNull();
expect(value).toBeTruthy();
expect(value).toBeFalsy();

// Number comparisons
expect(number).toBeGreaterThan(5);
expect(number).toBeLessThan(10);
expect(number).toBeCloseTo(3.14, 2);

// String matching
expect(string).toContain('substring');
expect(string).toMatch(/regex/);

// Error checking
expect(() => fn()).toThrow();
expect(() => fn()).toThrow('error message');
```

## Security Testing Checklist

```typescript
// ✅ Create users with correct roles using TestHelper
const userSignUp = await testHelper.graphQl({
  arguments: {
    input: {
      email: 'user@test.com',
      password: 'password123',
      firstName: 'Test',
    },
  },
  fields: ['token', { user: ['id'] }],
  name: 'signUp',
  type: TestGraphQLType.MUTATION,
});
const userToken = userSignUp.token;

// ✅ Test with correct role
await testHelper.rest('/api/resource', {
  token: userToken,
});

// ✅ Test without authentication
await testHelper.rest('/api/resource', {
  statusCode: 401,
});

// ✅ Test with insufficient permissions
await testHelper.rest('/api/admin/resource', {
  statusCode: 403,
  token: userToken, // Normal user trying admin endpoint
});

// ✅ Test access to own resources only
await testHelper.rest(`/api/users/${userSignUp.user.id}/profile`, {
  method: 'PUT',
  payload: { firstName: 'Updated' },
  token: userToken,
});

await testHelper.rest(`/api/users/${otherUserId}/profile`, {
  method: 'PUT',
  payload: { firstName: 'Hacker' },
  statusCode: 403,
  token: userToken,
});

// ❌ NEVER do this
// Don't remove @Restricted decorators
// Don't change @Roles to more permissive
// Don't disable security checks
```

## When to Ask Developer

```
❓ ASK when:
- Story has contradictions or ambiguities
- Need to change security decorators
- Need to add new npm package
- Multiple valid architectural approaches
- Tests keep failing for unclear reasons

✅ DON'T ASK when:
- Creating test files
- Running tests
- Analyzing failures
- Implementing obvious features
- Using nest-server-generator
```

## Debugging Failed Tests

When tests fail, use these debugging tools to analyze the issue:

### 1. TestHelper Logging Options

```typescript
// Enable detailed request/response logging
const result = await testHelper.graphQl({
  arguments: { id: userId },
  fields: ['id', 'email'],
  name: 'getUser',
  type: TestGraphQLType.QUERY,
}, {
  token: userToken,
  log: true,        // Logs request details
  logError: true,   // Logs errors when status >= 400
});

// For REST requests
const result = await testHelper.rest('/api/endpoint', {
  method: 'POST',
  payload: data,
  token: userToken,
  log: true,
  logError: true,
});
```

### 2. Server Exception Logging

Enable in `src/config.env.ts`:

```typescript
export default {
  // ... other config
  logExceptions: true,  // Log all exceptions with stack traces
  // ...
};
```

### 3. Validation Debug Logging

Enable validation debugging via environment variable:

```bash
# In your terminal or test script
DEBUG_VALIDATION=true npm test

# Or in your test file
process.env.DEBUG_VALIDATION = 'true';
```

This activates console.debug statements in MapAndValidatePipe (`node_modules/@lenne.tech/nest-server/src/core/common/pipes/map-and-validate.pipe.ts`) to show detailed validation errors.

### 4. Combined Debugging Setup

For comprehensive debugging, combine all three:

```typescript
// In your test file beforeAll
process.env.DEBUG_VALIDATION = 'true';

// In src/config.env.ts
export default {
  logExceptions: true,
  // ...
};

// In your tests
const result = await testHelper.graphQl({
  // ... your test
}, {
  log: true,
  logError: true,
});
```

## Decision Tree: Test Failure Analysis

```
Test fails
    │
    ├─► Missing implementation?
    │       └─► Go to Step 4 (Implement)
    │
    ├─► Test has bugs/errors?
    │       └─► Go to Step 3a (Fix test)
    │
    ├─► Security blocking correctly?
    │       └─► Fix test to use proper auth
    │
    ├─► Unclear error message?
    │       └─► Enable debugging (log, logError, logExceptions, DEBUG_VALIDATION)
    │
    └─► Still unclear why failing?
            └─► Ask developer
```

## Code Quality, Security & Refactoring Check

### Quick Review Guide

**Before marking complete, check for:**

1. **Code Duplication:**
   - Repeated validation logic → Extract to private method
   - Similar calculations in multiple places → Create helper function
   - Duplicated query patterns → Consolidate into flexible method

2. **Common Functionality:**
   - Extract repeated data transformations
   - Create shared validation helpers
   - Consolidate similar query builders

3. **Database Indexes:**
   - Fields used in queries → Add `mongoose: { index: true, type: String }` to @UnifiedField
   - Foreign keys → Add index via mongoose option
   - Unique fields → Add `mongoose: { index: true, unique: true, type: String }`
   - Multiple query fields → Index each individually

4. **🔐 Security Review (CRITICAL):**
   - @Restricted/@Roles decorators NOT removed or weakened
   - Ownership checks in place for user data
   - All inputs validated with DTOs
   - Sensitive fields marked with `hideField: true`
   - No injection vulnerabilities
   - Error messages don't leak sensitive data
   - Authorization tests pass

5. **Refactoring Decision:**
   ```
   Used in 2+ places? → Extract to private method
   Used across services? → Consider utility class
   Only 1 usage? → Leave as-is (don't over-engineer)
   ```

6. **After Refactoring & Security Review:**
   ```bash
   npm test  # MUST still pass!
   ```

### Code Quality Checklist

Before marking complete:

- [ ] All tests passing
- [ ] **No obvious code duplication**
- [ ] **Common functionality extracted to helpers**
- [ ] **Consistent patterns throughout**
- [ ] **Database indexes added to @UnifiedField decorators**
- [ ] **Indexes match query patterns in services**
- [ ] Test coverage adequate (80%+)
- [ ] Code follows existing patterns
- [ ] No unnecessary dependencies added
- [ ] Proper error handling
- [ ] Input validation implemented
- [ ] Documentation/comments where needed
- [ ] **Tests still pass after refactoring**

**🔐 Security Checklist:**

- [ ] **@Restricted/@Roles decorators NOT removed or weakened**
- [ ] **Ownership checks in place (users can only access own data)**
- [ ] **All inputs validated with proper DTOs**
- [ ] **Sensitive fields marked with hideField: true**
- [ ] **No SQL/NoSQL injection vulnerabilities**
- [ ] **Error messages don't expose sensitive data**
- [ ] **checkSecurity methods implemented in models**
- [ ] **Authorization tests pass**
- [ ] **No hardcoded secrets or credentials**

## Final Report Template

```markdown
# Story Implementation Complete ✅

## Story: [Name]

### Tests Created
- Location: test/stories/[filename].story.test.ts
- Test cases: X scenarios
- Coverage: X%

### Implementation Summary
- Modules: [list]
- Objects: [list]
- Properties: [list]
- Other: [list]

### Test Results
✅ All X tests passing

### Code Quality
- Patterns followed: ✅
- Security preserved: ✅
- Dependencies: None added ✅
- Code duplication checked: ✅
- Database indexes added: ✅
- Refactoring performed: [Yes/No]

### Security Review
- Authentication/Authorization: ✅
- Input validation: ✅
- Data exposure prevented: ✅
- Ownership checks: ✅
- Injection prevention: ✅
- Authorization tests pass: ✅

### Refactoring (if performed)
- Extracted helper functions: [list]
- Consolidated code paths: [describe]
- Removed duplication: [describe]
- Tests still passing: ✅

### Files Modified
1. path/to/file.ts - description
2. path/to/file.ts - description
```

## 🔄 Handling Existing Tests

**When your changes break existing tests:**

### Decision Tree

```
Existing test fails
    ├─► Intentional breaking change? (e.g., added required field)
    │   └─► ✅ Update test to match new behavior
    │
    └─► Unclear/unintended side effect?
        ├─► 🔍 Use git to investigate:
        │   - git show HEAD:path/to/file.ts
        │   - git diff HEAD path/to/file.ts
        │
        └─► ⚠️ Fix code to satisfy BOTH old AND new tests
```

### Git Analysis (ALLOWED)

```bash
# View old version of file
git show HEAD:src/server/modules/user/user.service.ts

# See what changed
git diff HEAD src/server/modules/user/user.service.ts

# View commit history
git log -p --follow path/to/file.ts
```

### Guidelines

**✅ Update tests when:**
- Intentional API contract change
- Removed deprecated functionality
- Renamed fields/methods
- Documented in story requirements

**❌ Don't update tests when:**
- Unclear why they're failing
- Unrelated to your story
- Multiple unrelated tests breaking
- Testing important existing functionality

**🚩 Red flags (investigate, don't update):**
- Tests in different modules failing
- Security/auth tests failing
- 3+ unrelated tests failing

**Remember:**
- Existing tests = documentation of expected behavior
- Use git freely for investigation (NOT commits!)
- When in doubt, preserve backward compatibility

## ⛔ CRITICAL: Git Commits

**🚨 NEVER create git commits unless explicitly requested by the developer.**

- ❌ DO NOT use `git add`, `git commit`, or `git push` automatically
- ❌ DO NOT commit changes when tests pass
- ❌ DO NOT assume developer wants changes committed
- ✅ ONLY commit when developer explicitly asks: "commit these changes"

**Why:** Developers may want to review changes, commit in specific chunks, or have custom workflows.

**Your job:**
- ✅ Create/modify files
- ✅ Run tests
- ✅ Use git for analysis (git show, git diff, git log)
- ✅ Provide comprehensive report
- ❌ Never commit to git (unless explicitly requested)

## 🚨 CRITICAL: Database Cleanup & Test Isolation

**ALWAYS implement comprehensive cleanup in your story tests!**

Test data that remains in the database can cause:
- False positives/negatives in tests
- Flaky tests that pass/fail randomly
- Contaminated test database
- Hard-to-debug test failures

### Between Test Suites - RECOMMENDED APPROACH

**Track all created entities and delete them explicitly:**

```typescript
describe('Feature Story', () => {
  // Track created entities
  let createdUserIds: string[] = [];
  let createdProductIds: string[] = [];
  let createdOrderIds: string[] = [];

  // In your tests, track IDs immediately after creation
  it('should create product', async () => {
    const product = await testHelper.rest('/api/products', {
      method: 'POST',
      payload: productData,
      token: adminToken,
    });

    // ✅ Track for cleanup
    createdProductIds.push(product.id);
  });

  afterAll(async () => {
    // 🧹 CLEANUP: Delete ALL test data created during tests
    try {
      // Delete in correct order (child entities first)
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
    } catch (error) {
      console.error('Cleanup failed:', error);
      // Don't throw - cleanup failures shouldn't fail the test suite
    }

    await connection.close();
    await app.close();
  });
});
```

### Alternative: Pattern-Based Cleanup (Less Reliable)

Only use this if you can't track IDs:

```typescript
afterAll(async () => {
  // Clean up test data by pattern (less reliable)
  await db.collection('users').deleteMany({ email: /@test\.com$/ });
  await db.collection('products').deleteMany({ name: /^Test/ });

  await connection.close();
  await app.close();
});
```

**⚠️ Warning:** Pattern-based cleanup can:
- Miss entities that don't match the pattern
- Delete unintended entities if pattern is too broad
- Be harder to debug when cleanup fails

### Between Individual Tests

Use `beforeEach`/`afterEach` only when necessary:

```typescript
describe('Feature Tests', () => {
  let sharedResource;

  beforeEach(async () => {
    // Reset state before each test if needed
    sharedResource = await createFreshResource();
  });

  afterEach(async () => {
    // Clean up after each test if needed
    await deleteResource(sharedResource.id);
  });
});
```

## User Authentication: signUp vs signIn

### When to use signUp

- Creating new users in tests
- Full control over user data needed
- Testing user registration flows
- Most common in story tests

```typescript
const signUp = await testHelper.graphQl({
  arguments: {
    input: {
      email: `test-${Date.now()}@example.com`,  // Unique email
      password: 'testpass123',
      firstName: 'Test',
    },
  },
  fields: ['token', { user: ['id', 'email'] }],
  name: 'signUp',
  type: TestGraphQLType.MUTATION,
});
const token = signUp.token;
```

### When to use signIn

- Authenticating existing users
- User already exists in database
- Testing login flows

```typescript
const signIn = await testHelper.rest('/auth/signin', {
  method: 'POST',
  payload: {
    email: existingUserEmail,
    password: existingUserPassword,
  },
});
const token = signIn.token;
```

## Avoiding Test Interdependencies

### ❌ DON'T: Shared state between tests

```typescript
// ❌ BAD: Test 2 depends on Test 1
let createdUserId;

it('should create user', async () => {
  const user = await createUser(...);
  createdUserId = user.id;  // ❌ Shared state!
});

it('should update user', async () => {
  await updateUser(createdUserId, ...);  // ❌ Depends on Test 1!
});
```

### ✅ DO: Independent tests

```typescript
// ✅ GOOD: Each test is independent
describe('User CRUD', () => {
  let testUserId;

  beforeEach(async () => {
    // Create fresh user for EACH test
    const user = await createUser(...);
    testUserId = user.id;
  });

  afterEach(async () => {
    // Clean up after each test
    await deleteUser(testUserId);
  });

  it('should update user', async () => {
    await updateUser(testUserId, ...);  // ✅ Independent!
  });

  it('should delete user', async () => {
    await deleteUser(testUserId, ...);  // ✅ Independent!
  });
});
```

## Async/Await Best Practices

### Always await async operations

```typescript
// ❌ WRONG: Forgotten await
const user = testHelper.graphQl({...});  // Returns Promise, not user!
expect(user.email).toBe('test@example.com');  // FAILS!

// ✅ CORRECT: With await
const user = await testHelper.graphQl({...});
expect(user.email).toBe('test@example.com');  // Works!
```

### Parallel vs Sequential execution

```typescript
// ✅ Parallel execution (independent operations)
const [user1, user2, product] = await Promise.all([
  testHelper.graphQl({...}),  // Create user 1
  testHelper.graphQl({...}),  // Create user 2
  testHelper.rest('/api/products', {...}),  // Create product
]);

// ✅ Sequential execution (dependent operations)
const user = await testHelper.graphQl({...});
const product = await testHelper.rest('/api/products', {
  token: user.token,  // Depends on user being created first
  payload: {...},
  method: 'POST',
});

// ❌ WRONG: Sequential when parallel is possible (slower)
const user1 = await testHelper.graphQl({...});
const user2 = await testHelper.graphQl({...});  // Could run in parallel!
const product = await testHelper.rest('/api/products', {...});
```

### Handling errors with async/await

```typescript
// Test that async operation throws error
await expect(async () => {
  await testHelper.rest('/api/resource', {
    payload: invalidData,
    token: userToken,
  });
}).rejects.toThrow();

// Or use statusCode option
await testHelper.rest('/api/resource', {
  payload: invalidData,
  statusCode: 400,
  token: userToken,
});
```

## Common Pitfalls to Avoid

❌ **Don't:**
- Write code before tests
- Skip test analysis step
- **Weaken security for passing tests**
- **Remove or weaken @Restricted/@Roles decorators**
- **Skip security review before marking complete**
- Add dependencies without checking existing
- Ignore existing code patterns
- Batch test completions (mark complete immediately)
- Work on multiple tasks simultaneously
- **Create git commits without explicit request**
- Forget `await` on async calls
- Create test interdependencies
- **Forget to implement cleanup in afterAll**
- **Forget to track created entity IDs for cleanup**
- Clean up too aggressively (breaking other tests)
- Use pattern-based cleanup when ID tracking is possible
- **Skip code quality check before marking complete**
- **Leave obvious code duplication in place**
- Over-engineer by extracting single-use code
- **Define indexes separately in schema files**
- **Forget to add indexes for queried fields**
- Add indexes to fields that are never queried
- **Expose sensitive fields without hideField**
- **Allow users to access others' data without checks**
- **Use 'any' type instead of proper DTOs**

✅ **Do:**
- Follow the 7-step process strictly (including Step 5a security & refactoring check)
- Ask for clarification early
- **Preserve all security mechanisms (CRITICAL)**
- **Perform security review before marking complete**
- Study existing code first
- Match existing patterns
- Mark todos complete as you finish them
- Focus on one step at a time
- **Wait for developer to commit changes**
- Always use `await` with async operations
- Make tests independent
- Use `beforeEach`/`afterEach` for test isolation
- Use Promise.all() for parallel operations
- **ALWAYS implement comprehensive cleanup in afterAll**
- **Track all created entity IDs immediately after creation**
- Delete entities in correct order (children before parents)
- **Check for code duplication before marking complete**
- **Extract common functionality to helpers when used 2+ times**
- **Run tests again after refactoring**
- **Verify ownership checks for user data access**
- **Mark sensitive fields with hideField: true**
- **Use proper DTOs with validation decorators**
- **Ensure authorization tests pass**

## Integration Points

### With nest-server-generator
- Use for creating modules, objects, properties
- Use for understanding NestJS patterns
- Use for reading CrudService implementations

### With Existing Tests
- Study patterns in test/ directory
- Copy authentication setup approach
- Use same helper functions
- Match assertion style

### With API Documentation
- Check Controllers for REST endpoints
- Review Swagger annotations
- Understand existing data models
- Verify GraphQL schema if applicable

---

**Remember:** Tests first, code second. Iterate until green. **Security review mandatory.** Refactor before done. Quality over speed.