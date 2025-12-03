---
name: nest-server-generator-workflow
version: 1.0.0
description: Complete 7-phase workflow for NestJS module/object generation - from analysis to testing, including SubObject creation, inheritance handling, description management, enum files, and comprehensive API testing with security validation
---

# Workflow Process

## Table of Contents
- [Phase 1: Analysis & Planning](#phase-1-analysis--planning)
- [Phase 2: SubObject Creation](#phase-2-subobject-creation)
- [Phase 3: Module Creation](#phase-3-module-creation)
- [Phase 4: Inheritance Handling](#phase-4-inheritance-handling)
- [Phase 5: Description Management](#phase-5-description-management)
- [Phase 6: Enum File Creation](#phase-6-enum-file-creation)
- [Phase 7: API Test Creation](#phase-7-api-test-creation)

### Phase 1: Analysis & Planning

1. **Parse the specification** completely
2. **Identify all components**:
   - List all SubObjects
   - List all Objects
   - List all Modules
   - Identify inheritance relationships
   - Identify enum types needed
3. **Create comprehensive todo list** with:
   - Create each SubObject
   - Create each Object
   - Create each Module
   - Handle inheritance modifications
   - Create enum files
   - Create API tests for each module
   - Run tests and verify

**Phase 1 Checklist:**
- [ ] Specification completely parsed
- [ ] All components identified (SubObjects, Objects, Modules)
- [ ] Inheritance relationships documented
- [ ] Enum types listed
- [ ] Comprehensive todo list created
- [ ] Ready for Phase 2

### Phase 2: SubObject Creation

**Create SubObjects in dependency order** (if SubObject A contains SubObject B, create B first):

```bash
lt server object --name <ObjectName> \
  --prop-name-0 <name> --prop-type-0 <type> \
  --prop-name-1 <name> --prop-type-1 <type> \
  ...
```

**Apply modifiers**:
- Optional: `--prop-nullable-X true`
- Array: `--prop-array-X true`
- Enum: `--prop-enum-X <EnumName>`
- Schema: `--prop-schema-X <SchemaName>`

**Phase 2 Checklist:**
- [ ] All SubObjects created in correct dependency order
- [ ] All modifiers applied (nullable, array, enum, schema)
- [ ] Properties in alphabetical order
- [ ] No circular dependencies
- [ ] Ready for Phase 3

### Phase 3: Module Creation

**Create modules with all properties**:

```bash
lt server module --name <ModuleName> --controller <Rest|GraphQL|Both> \
  --prop-name-0 <name> --prop-type-0 <type> \
  --prop-name-1 <name> --prop-type-1 <type> \
  ...
```

**For references to other modules**:
```bash
--prop-name-X author --prop-type-X ObjectId --prop-reference-X User
```

**For embedded objects**:
```bash
--prop-name-X address --prop-schema-X Address
```

**Phase 3 Checklist:**
- [ ] All modules created with correct properties
- [ ] References correctly set (ObjectId with --prop-reference-X)
- [ ] Embedded objects correctly referenced (--prop-schema-X)
- [ ] Properties in alphabetical order
- [ ] All required imports present
- [ ] Ready for Phase 4

### Phase 4: Inheritance Handling

When a model extends another model (e.g., `Extends: Profile`):

1. **Identify parent model location**:
   - Core models (from @lenne.tech/nest-server): CoreModel, CorePersisted, etc.
   - Custom parent models: Need to find in project

2. **For Core parent models**:
   - Replace in model file: `extends CoreModel` → `extends ParentModel`
   - Import: `import { ParentModel } from './path'`

3. **For custom parent models (objects/other modules)**:
   - Model extends parent object: Import and extend
   - Input files must include parent properties

4. **Input/Output inheritance**:
   - **CreateInput**: Must include ALL required properties from parent AND model
   - **UpdateInput**: Include all properties as optional
   - Check parent's CreateInput for required fields
   - Copy required fields to child's CreateInput

**Example**: If `BuyerProfile` extends `Profile`:
```typescript
// buyer-profile.model.ts
import { Profile } from '../../common/objects/profile/profile.object';
export class BuyerProfile extends Profile { ... }

// buyer-profile-create.input.ts
// Must include ALL required fields from Profile's create input + BuyerProfile fields
```

**Phase 4 Checklist:**
- [ ] All parent models identified (Core or custom)
- [ ] Model extends correct parent class
- [ ] Imports updated correctly
- [ ] CreateInput includes ALL parent required fields
- [ ] UpdateInput includes all properties as optional
- [ ] No missing required fields
- [ ] Ready for Phase 5

### Phase 5: Description Management

**⚠️ CRITICAL PHASE - Refer to "CRITICAL: DESCRIPTION MANAGEMENT" section at the top of this document!**

This phase is often done incorrectly. Follow these steps EXACTLY:

#### Step 5.1: Extract Descriptions from User Input

**BEFORE applying any descriptions, review the original specification:**

Go back to the user's original specification and extract ALL comments that appear after `//`:

```
Module: Product
- name: string // Product name
- price: number // Produktpreis
- description?: string // Produktbeschreibung
- stock: number // Current inventory

SubObject: Address
- street: string // Straße
- city: string // City name
- zipCode: string // Postleitzahl
```

**Create a mapping**:
```
Product.name → "Product name" (English)
Product.price → "Produktpreis" (German)
Product.description → "Produktbeschreibung" (German)
Product.stock → "Current inventory" (English)
Address.street → "Straße" (German)
Address.city → "City name" (English)
Address.zipCode → "Postleitzahl" (German)
```

#### Step 5.2: Format Descriptions

**Rule**: `"ENGLISH_DESCRIPTION (DEUTSCHE_BESCHREIBUNG)"`

Apply formatting rules:

1. **If comment is in English**:
   ```
   // Product name
   ```
   → Use as: `description: 'Product name'`

   Fix typos if needed:
   ```
   // Prodcut name  (typo)
   ```
   → Use as: `description: 'Product name'` (typo corrected)

2. **If comment is in German**:
   ```
   // Produktpreis
   ```
   → Translate and add original: `description: 'Product price (Produktpreis)'`

   ```
   // Straße
   ```
   → Translate and add original: `description: 'Street (Straße)'`

   Fix typos in original:
   ```
   // Postleizahl  (typo: missing 't')
   ```
   → Translate and add corrected: `description: 'Postal code (Postleitzahl)'`

3. **If no comment provided**:
   → Create meaningful English description: `description: 'User email address'`

**⚠️ CRITICAL - Preserve Original Wording**:

- ✅ **DO:** Fix spelling/typos only
- ❌ **DON'T:** Rephrase, expand, or improve wording
- ❌ **DON'T:** Change terms (they may be predefined/referenced by external systems)

**Examples**:
```
✅ CORRECT:
// Straße → 'Street (Straße)'  (preserve word)
// Produkt → 'Product (Produkt)'  (don't add "name")
// Status → 'Status (Status)'  (same in both languages)

❌ WRONG:
// Straße → 'Street name (Straßenname)'  (changed word!)
// Produkt → 'Product name (Produktname)'  (added word!)
// Status → 'Current status (Aktueller Status)'  (added word!)
```

#### Step 5.3: Apply Descriptions EVERYWHERE

**🚨 MOST IMPORTANT: Apply SAME description to ALL files!**

For **EVERY property in EVERY Module**:

1. Open `<module>.model.ts` → Add description to property
2. Open `inputs/<module>-create.input.ts` → Add SAME description to property
3. Open `inputs/<module>.input.ts` → Add SAME description to property

For **EVERY property in EVERY SubObject**:

1. Open `objects/<object>/<object>.object.ts` → Add description to property
2. Open `objects/<object>/<object>-create.input.ts` → Add SAME description to property
3. Open `objects/<object>/<object>.input.ts` → Add SAME description to property

**Example for Module "Product" with property "price"**:

```typescript
// File: src/server/modules/product/product.model.ts
@UnifiedField({ description: 'Product price (Produktpreis)' })
price: number;

// File: src/server/modules/product/inputs/product-create.input.ts
@UnifiedField({ description: 'Product price (Produktpreis)' })
price: number;

// File: src/server/modules/product/inputs/product.input.ts
@UnifiedField({ description: 'Product price (Produktpreis)' })
price?: number;
```

**Example for SubObject "Address" with property "street"**:

```typescript
// File: src/server/common/objects/address/address.object.ts
@UnifiedField({ description: 'Street (Straße)' })
street: string;

// File: src/server/common/objects/address/address-create.input.ts
@UnifiedField({ description: 'Street (Straße)' })
street: string;

// File: src/server/common/objects/address/address.input.ts
@UnifiedField({ description: 'Street (Straße)' })
street?: string;
```

#### Step 5.4: Add Class-Level Descriptions

Also add descriptions to the `@ObjectType()` and `@InputType()` decorators:

```typescript
@ObjectType({ description: 'Product entity (Produkt-Entität)' })
export class Product extends CoreModel { ... }

@InputType({ description: 'Product creation data (Produkt-Erstellungsdaten)' })
export class ProductCreateInput { ... }

@InputType({ description: 'Product update data (Produkt-Aktualisierungsdaten)' })
export class ProductInput { ... }
```

#### Step 5.5: Verify Consistency

After applying all descriptions, verify:

- [ ] All user-provided comments extracted and processed
- [ ] All German descriptions translated to format: `ENGLISH (DEUTSCH)`
- [ ] All English descriptions kept as-is
- [ ] Module Model has descriptions on all properties
- [ ] Module CreateInput has SAME descriptions on all properties
- [ ] Module UpdateInput has SAME descriptions on all properties
- [ ] SubObject has descriptions on all properties
- [ ] SubObject CreateInput has SAME descriptions on all properties
- [ ] SubObject UpdateInput has SAME descriptions on all properties
- [ ] Class-level decorators have descriptions
- [ ] NO inconsistencies (same property, different descriptions)

**If ANY checkbox is unchecked, STOP and fix before continuing to Phase 6!**

**Phase 5 Checklist:**
- [ ] All user-provided comments extracted and processed
- [ ] All German descriptions translated to format: ENGLISH (DEUTSCH)
- [ ] All English descriptions kept as-is (typos fixed only)
- [ ] Descriptions applied to ALL Model properties
- [ ] Descriptions applied to ALL CreateInput properties
- [ ] Descriptions applied to ALL UpdateInput properties
- [ ] Descriptions applied to ALL SubObject properties
- [ ] Class-level decorators have descriptions
- [ ] NO inconsistencies (same property different descriptions)
- [ ] Ready for Phase 6

### Phase 6: Enum File Creation

For each enum used, create enum file manually:

```typescript
// src/server/common/enums/status.enum.ts
export enum StatusEnum {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
}
```

**Naming convention**:
- File: `kebab-case.enum.ts`
- Enum: `PascalCaseEnum`
- Values: `UPPER_SNAKE_CASE`

**Phase 6 Checklist:**
- [ ] All enum files created in src/server/common/enums/
- [ ] File naming follows kebab-case.enum.ts
- [ ] Enum naming follows PascalCaseEnum
- [ ] Values follow UPPER_SNAKE_CASE
- [ ] All enums properly imported where used
- [ ] Ready for Phase 7

### Phase 7: API Test Creation

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

**Exception: Direct database/service access for test setup/cleanup ONLY**

Direct database or service access is ONLY allowed for:

- ✅ **Test Setup (beforeAll/beforeEach)**:
  - Setting user roles in database: `await db.collection('users').updateOne({ _id: userId }, { $set: { roles: ['admin'] } })`
  - Setting verified flag: `await db.collection('users').updateOne({ _id: userId }, { $set: { verified: true } })`
  - Creating prerequisite test data that can't be created via API

- ✅ **Test Cleanup (afterAll/afterEach)**:
  - Deleting test objects: `await db.collection('products').deleteMany({ createdBy: testUserId })`
  - Cleaning up test data: `await db.collection('users').deleteOne({ email: 'test@example.com' })`

- ❌ **NEVER for testing functionality**:
  - Don't call `userService.create()` to test user creation - use API endpoint!
  - Don't call `productService.update()` to test updates - use API endpoint!
  - Don't access database to verify results - query via API instead!

**Example of correct usage:**

```typescript
describe('Product Tests', () => {
  let adminToken: string;
  let userId: string;

  beforeAll(async () => {
    // ✅ ALLOWED: Direct DB access for setup
    const user = await testHelper.rest('/auth/signup', {
      method: 'POST',
      payload: { email: 'admin@test.com', password: 'password' }
    });
    userId = user.id;

    // ✅ ALLOWED: Direct DB manipulation for test setup
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: { roles: ['admin'], verified: true } }
    );

    // Get token via API
    const auth = await testHelper.rest('/auth/signin', {
      method: 'POST',
      payload: { email: 'admin@test.com', password: 'password' }
    });
    adminToken = auth.token;
  });

  it('should create product', async () => {
    // ✅ CORRECT: Test via API
    const result = await testHelper.rest('/api/products', {
      method: 'POST',
      payload: { name: 'Test Product' },
      token: adminToken
    });

    expect(result.name).toBe('Test Product');

    // ❌ WRONG: Don't verify via DB
    // const dbProduct = await db.collection('products').findOne({ _id: result.id });

    // ✅ CORRECT: Verify via API
    const fetched = await testHelper.rest(`/api/products/${result.id}`, {
      method: 'GET',
      token: adminToken
    });
    expect(fetched.name).toBe('Test Product');
  });

  afterAll(async () => {
    // ✅ ALLOWED: Direct DB access for cleanup
    await db.collection('products').deleteMany({ createdBy: userId });
    await db.collection('users').deleteOne({ _id: new ObjectId(userId) });
  });
});
```

---

**⚠️ CRITICAL: Test Creation Process**

Creating API tests is NOT just about testing functionality - it's about **validating the security model**. You MUST follow this exact process:

---

#### Step 1: 🔍 MANDATORY Permission Analysis (BEFORE writing ANY test)

**YOU MUST analyze these THREE layers BEFORE writing a single test:**

1. **Controller/Resolver Layer** - Check `@Roles()` decorator:
   ```typescript
   // In product.resolver.ts
   @Roles(RoleEnum.S_EVERYONE)  // ← WHO can call this?
   @Query(() => [Product])
   async getProducts() { ... }

   @Roles(RoleEnum.S_USER)      // ← All signed-in users
   @Mutation(() => Product)
   async createProduct(@Args('input') input: ProductCreateInput) { ... }

   @Roles(RoleEnum.ADMIN, RoleEnum.S_CREATOR)  // ← Only admin or creator
   @Mutation(() => Product)
   async updateProduct(@Args('id') id: string, @Args('input') input: ProductInput) { ... }
   ```

2. **Model Layer** - Check `@Restricted()` and `securityCheck()`:
   ```typescript
   // In product.model.ts
   export class Product extends CoreModel {
     securityCheck(user: User, force?: boolean) {
       if (force || user?.hasRole(RoleEnum.ADMIN)) {
         return this; // Admin sees all
       }
       if (this.isPublic) {
         return this; // Everyone sees public products
       }
       if (!equalIds(user, this.createdBy)) {
         return undefined; // Non-creator gets nothing
       }
       return this; // Creator sees own products
     }
   }
   ```

3. **Service Layer** - Check `serviceOptions.roles` usage:
   ```typescript
   // In product.service.ts
   async update(id: string, input: ProductInput, serviceOptions?: ServiceOptions) {
     // Check if user has ADMIN or S_CREATOR role
     // ...
   }
   ```

**Permission Analysis Checklist:**
- [ ] I have checked ALL `@Roles()` decorators in controller/resolver
- [ ] I have read the complete `securityCheck()` method in the model
- [ ] I have checked ALL `@Restricted()` decorators
- [ ] I understand WHO can CREATE (usually S_USER or ADMIN)
- [ ] I understand WHO can READ (S_USER + securityCheck filtering)
- [ ] I understand WHO can UPDATE (usually ADMIN + S_CREATOR)
- [ ] I understand WHO can DELETE (usually ADMIN + S_CREATOR)

**Common Permission Patterns:**
- `S_EVERYONE` → No authentication required
- `S_USER` → Any signed-in user
- `ADMIN` → User with 'admin' role
- `S_CREATOR` → User who created the resource (user.id === object.createdBy)

---

#### Step 2: 🎯 Apply Principle of Least Privilege

**GOLDEN RULE**: Always test with the **LEAST privileged user** who is still authorized.

**Decision Tree:**

```
Is endpoint marked with @Roles(RoleEnum.S_EVERYONE)?
├─ YES → Test WITHOUT token (unauthenticated)
└─ NO  → Is endpoint marked with @Roles(RoleEnum.S_USER)?
         ├─ YES → Test WITH regular user token (NOT admin, NOT creator)
         └─ NO  → Is endpoint marked with @Roles(RoleEnum.ADMIN, RoleEnum.S_CREATOR)?
                  ├─ For UPDATE/DELETE → Test WITH creator token (user who created it)
                  └─ For ADMIN-only → Test WITH admin token
```

**❌ WRONG Approach:**
```typescript
// BAD: Using admin for everything
it('should create product', async () => {
  const result = await testHelper.graphQl({
    name: 'createProduct',
    type: TestGraphQLType.MUTATION,
    arguments: { input: { name: 'Test' } },
    fields: ['id']
  }, { token: adminToken }); // ❌ WRONG - Over-privileged!
});
```

**✅ CORRECT Approach:**
```typescript
// GOOD: Using least privileged user
it('should create product as regular user', async () => {
  const result = await testHelper.graphQl({
    name: 'createProduct',
    type: TestGraphQLType.MUTATION,
    arguments: { input: { name: 'Test' } },
    fields: ['id']
  }, { token: userToken }); // ✅ CORRECT - S_USER is enough!
});
```

---

#### Step 3: 📋 Create Test User Matrix

Based on your permission analysis, create test users:

```typescript
describe('Product API', () => {
  let testHelper: TestHelper;

  // Create users based on ACTUAL needs (not all of them!)
  let noToken: undefined;           // For S_EVERYONE endpoints
  let userToken: string;            // For S_USER endpoints
  let creatorToken: string;         // For S_CREATOR (will create test data)
  let otherUserToken: string;       // For testing "not creator" scenarios
  let adminToken: string;           // Only if ADMIN-specific endpoints exist

  let createdProductId: string;

  beforeAll(async () => {
    testHelper = new TestHelper(app);

    // Only create users you ACTUALLY need based on @Roles() analysis!

    // Regular user (for S_USER endpoints)
    const userAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: {
        input: {
          email: 'user@test.com',
          password: 'password',
          roles: ['user']  // Regular user, no special privileges
        }
      },
      fields: ['token', 'user { id }']
    });
    userToken = userAuth.token;

    // Creator user (will create test objects)
    const creatorAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: {
        input: {
          email: 'creator@test.com',
          password: 'password',
          roles: ['user']
        }
      },
      fields: ['token', 'user { id }']
    });
    creatorToken = creatorAuth.token;

    // Other user (to test "not creator" scenarios)
    const otherUserAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: {
        input: {
          email: 'other@test.com',
          password: 'password',
          roles: ['user']
        }
      },
      fields: ['token', 'user { id }']
    });
    otherUserToken = otherUserAuth.token;

    // Admin user (ONLY if truly needed!)
    const adminAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: {
        input: {
          email: 'admin@test.com',
          password: 'password',
          roles: ['admin', 'user']  // ← 'admin' role!
        }
      },
      fields: ['token']
    });
    adminToken = adminAuth.token;
  });

  afterAll(async () => {
    // Clean up with appropriate privileged user
    if (createdProductId) {
      // Use creator or admin token for cleanup
      await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdProductId },
        fields: ['id']
      }, { token: creatorToken });
    }
  });
});
```

---

#### Step 4: ✅ Write Tests with Correct Privileges

**Example 1: S_EVERYONE endpoint (public access)**

```typescript
// Endpoint: @Roles(RoleEnum.S_EVERYONE)
describe('Public Endpoints', () => {
  it('should get public products WITHOUT token', async () => {
    const result = await testHelper.graphQl({
      name: 'getPublicProducts',
      type: TestGraphQLType.QUERY,
      fields: ['id', 'name', 'price']
    }); // ← NO TOKEN! S_EVERYONE means unauthenticated is OK

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });
});
```

**Example 2: S_USER endpoint (any authenticated user)**

```typescript
// Endpoint: @Roles(RoleEnum.S_USER)
describe('Create Product', () => {
  it('should create product as regular user', async () => {
    const result = await testHelper.graphQl({
      name: 'createProduct',
      type: TestGraphQLType.MUTATION,
      arguments: { input: { name: 'Test Product', price: 10 } },
      fields: ['id', 'name', 'price', 'createdBy']
    }, { token: userToken }); // ← Regular user, NOT admin!

    expect(result).toBeDefined();
    expect(result.name).toBe('Test Product');
    createdProductId = result.id;

    // Verify creator is set
    expect(result.createdBy).toBe(userAuth.user.id);
  });
});
```

**Example 3: UPDATE - S_CREATOR or ADMIN**

```typescript
// Endpoint: @Roles(RoleEnum.ADMIN, RoleEnum.S_CREATOR)
describe('Update Product', () => {
  it('should update product as creator', async () => {
    // First, creator creates a product
    const created = await testHelper.graphQl({
      name: 'createProduct',
      type: TestGraphQLType.MUTATION,
      arguments: { input: { name: 'Original', price: 10 } },
      fields: ['id', 'name']
    }, { token: creatorToken });

    // Then, same creator updates it
    const result = await testHelper.graphQl({
      name: 'updateProduct',
      type: TestGraphQLType.MUTATION,
      arguments: {
        id: created.id,
        input: { name: 'Updated' }
      },
      fields: ['id', 'name']
    }, { token: creatorToken }); // ← Use CREATOR token (least privilege!)

    expect(result.name).toBe('Updated');
  });

  it('should update any product as admin', async () => {
    // Admin can update products they did NOT create
    const result = await testHelper.graphQl({
      name: 'updateProduct',
      type: TestGraphQLType.MUTATION,
      arguments: {
        id: createdProductId, // Created by different user
        input: { name: 'Admin Updated' }
      },
      fields: ['id', 'name']
    }, { token: adminToken }); // ← Admin needed for other's products

    expect(result.name).toBe('Admin Updated');
  });
});
```

---

#### Step 5: 🛡️ MANDATORY: Test Permission Failures

**CRITICAL**: You MUST test that unauthorized users are BLOCKED. This validates the security model.

```typescript
describe('Security Validation', () => {
  describe('Unauthorized Access', () => {
    it('should FAIL to create product without authentication', async () => {
      // @Roles(RoleEnum.S_USER) requires authentication
      const result = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: { name: 'Hack', price: 1 } },
        fields: ['id']
      }, { statusCode: 401 }); // ← NO TOKEN = should fail with 401

      expect(result.errors).toBeDefined();
      expect(result.errors[0].message).toContain('Unauthorized');
    });

    it('should FAIL to update product as non-creator', async () => {
      // @Roles(RoleEnum.ADMIN, RoleEnum.S_CREATOR)
      const result = await testHelper.graphQl({
        name: 'updateProduct',
        type: TestGraphQLType.MUTATION,
        arguments: {
          id: createdProductId, // Created by creatorUser
          input: { name: 'Hacked' }
        },
        fields: ['id']
      }, { token: otherUserToken, statusCode: 403 }); // ← Different user = should fail with 403

      expect(result.errors).toBeDefined();
      expect(result.errors[0].message).toContain('Forbidden');
    });

    it('should FAIL to delete product as non-creator', async () => {
      const result = await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdProductId },
        fields: ['id']
      }, { token: otherUserToken, statusCode: 403 });

      expect(result.errors).toBeDefined();
    });

    it('should FAIL to read private product as different user', async () => {
      // If securityCheck() blocks non-creators
      const result = await testHelper.graphQl({
        name: 'getProduct',
        type: TestGraphQLType.QUERY,
        arguments: { id: privateProductId },
        fields: ['id', 'name']
      }, { token: otherUserToken });

      // securityCheck returns undefined for non-creator
      expect(result).toBeUndefined();
    });
  });
});
```

---

#### Step 6: 📝 Complete Test Structure

**Test file location**:
```
tests/modules/<module-name>.e2e-spec.ts
```

**Complete test template with proper privileges**:

```typescript
import { TestGraphQLType, TestHelper } from '@lenne.tech/nest-server';

describe('Product Module E2E', () => {
  let testHelper: TestHelper;
  let userToken: string;
  let creatorToken: string;
  let otherUserToken: string;
  let adminToken: string;
  let createdProductId: string;
  let userAuth: any;
  let creatorAuth: any;

  beforeAll(async () => {
    testHelper = new TestHelper(app);

    // Create test users (based on permission analysis)
    userAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: { input: { email: 'user@test.com', password: 'password', roles: ['user'] } },
      fields: ['token', 'user { id }']
    });
    userToken = userAuth.token;

    creatorAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: { input: { email: 'creator@test.com', password: 'password', roles: ['user'] } },
      fields: ['token', 'user { id }']
    });
    creatorToken = creatorAuth.token;

    const otherUserAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: { input: { email: 'other@test.com', password: 'password', roles: ['user'] } },
      fields: ['token']
    });
    otherUserToken = otherUserAuth.token;

    const adminAuth = await testHelper.graphQl({
      name: 'signUp',
      type: TestGraphQLType.MUTATION,
      arguments: { input: { email: 'admin@test.com', password: 'password', roles: ['admin', 'user'] } },
      fields: ['token']
    });
    adminToken = adminAuth.token;
  });

  afterAll(async () => {
    // Cleanup with appropriate privileges
    if (createdProductId) {
      await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdProductId },
        fields: ['id']
      }, { token: creatorToken });
    }
  });

  // 1. CREATE Tests (with least privileged user)
  describe('Create Product', () => {
    it('should create product as regular user', async () => {
      const result = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: { name: 'Test', price: 10 } },
        fields: ['id', 'name', 'price', 'createdBy']
      }, { token: userToken }); // ← S_USER = regular user

      expect(result.name).toBe('Test');
      createdProductId = result.id;
    });

    it('should FAIL to create without authentication', async () => {
      const result = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: { name: 'Fail', price: 10 } },
        fields: ['id']
      }, { statusCode: 401 }); // ← No token = should fail

      expect(result.errors).toBeDefined();
    });

    it('should FAIL to create without required fields', async () => {
      const result = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: {} },
        fields: ['id']
      }, { token: userToken, statusCode: 400 });

      expect(result.errors).toBeDefined();
    });
  });

  // 2. READ Tests
  describe('Get Products', () => {
    it('should get all products as regular user', async () => {
      const result = await testHelper.graphQl({
        name: 'getProducts',
        type: TestGraphQLType.QUERY,
        fields: ['id', 'name', 'price']
      }, { token: userToken });

      expect(Array.isArray(result)).toBe(true);
    });

    it('should get product by ID as regular user', async () => {
      const result = await testHelper.graphQl({
        name: 'getProduct',
        type: TestGraphQLType.QUERY,
        arguments: { id: createdProductId },
        fields: ['id', 'name', 'price']
      }, { token: userToken });

      expect(result.id).toBe(createdProductId);
    });
  });

  // 3. UPDATE Tests (with creator, not admin!)
  describe('Update Product', () => {
    let creatorProductId: string;

    beforeAll(async () => {
      // Creator creates a product to test updates
      const created = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: { name: 'Creator Product', price: 20 } },
        fields: ['id']
      }, { token: creatorToken });
      creatorProductId = created.id;
    });

    it('should update product as creator', async () => {
      const result = await testHelper.graphQl({
        name: 'updateProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: creatorProductId, input: { name: 'Updated' } },
        fields: ['id', 'name']
      }, { token: creatorToken }); // ← CREATOR token (least privilege!)

      expect(result.name).toBe('Updated');
    });

    it('should FAIL to update product as non-creator', async () => {
      const result = await testHelper.graphQl({
        name: 'updateProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: creatorProductId, input: { name: 'Hacked' } },
        fields: ['id']
      }, { token: otherUserToken, statusCode: 403 });

      expect(result.errors).toBeDefined();
    });

    it('should update any product as admin', async () => {
      const result = await testHelper.graphQl({
        name: 'updateProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: creatorProductId, input: { name: 'Admin Update' } },
        fields: ['id', 'name']
      }, { token: adminToken });

      expect(result.name).toBe('Admin Update');
    });
  });

  // 4. DELETE Tests (with creator, not admin!)
  describe('Delete Product', () => {
    it('should delete product as creator', async () => {
      // Creator creates and deletes
      const created = await testHelper.graphQl({
        name: 'createProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { input: { name: 'To Delete', price: 5 } },
        fields: ['id']
      }, { token: creatorToken });

      const result = await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: created.id },
        fields: ['id']
      }, { token: creatorToken }); // ← CREATOR token!

      expect(result.id).toBe(created.id);
    });

    it('should FAIL to delete product as non-creator', async () => {
      const result = await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdProductId },
        fields: ['id']
      }, { token: otherUserToken, statusCode: 403 });

      expect(result.errors).toBeDefined();
    });

    it('should delete any product as admin', async () => {
      const result = await testHelper.graphQl({
        name: 'deleteProduct',
        type: TestGraphQLType.MUTATION,
        arguments: { id: createdProductId },
        fields: ['id']
      }, { token: adminToken });

      expect(result.id).toBe(createdProductId);
    });
  });
});
```

---

#### Test Creation Checklist

Before finalizing tests, verify:

- [ ] ✅ I have analyzed ALL `@Roles()` decorators
- [ ] ✅ I have read the complete `securityCheck()` method
- [ ] ✅ I use the LEAST privileged user for each test
- [ ] ✅ S_EVERYONE endpoints tested WITHOUT token
- [ ] ✅ S_USER endpoints tested with REGULAR user (not admin)
- [ ] ✅ UPDATE/DELETE tested with CREATOR token (not admin)
- [ ] ✅ I have tests that verify unauthorized access FAILS (401/403)
- [ ] ✅ I have tests that verify non-creators CANNOT update/delete
- [ ] ✅ I have tests for missing required fields
- [ ] ✅ All tests follow the security model
- [ ] ✅ Tests validate protection mechanisms work

**⚠️ NEVER use admin token when a less privileged user would work!**

