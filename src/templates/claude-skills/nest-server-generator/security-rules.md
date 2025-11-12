---
name: nest-server-generator-security-rules
version: 1.0.0
description: Critical security and test coverage rules for NestJS development
---

# 🚨 CRITICAL SECURITY RULES

**Before you start ANY work, understand these NON-NEGOTIABLE rules.**

---

## ⛔ NEVER Do This

1. **NEVER remove or weaken `@Restricted()` decorators** to make tests pass
2. **NEVER change `@Roles()` decorators** to more permissive roles for test convenience
3. **NEVER modify `securityCheck()` logic** to bypass security in tests
4. **NEVER remove class-level `@Restricted(RoleEnum.ADMIN)`** - it's a security fallback

---

## ✅ ALWAYS Do This

1. **ALWAYS analyze permissions BEFORE writing tests** (Controller, Model, Service layers)
2. **ALWAYS test with the LEAST privileged user** who is authorized
3. **ALWAYS create appropriate test users** for each permission level
4. **ALWAYS adapt tests to security requirements**, never the other way around
5. **ALWAYS ask developer for approval** before changing ANY security decorator
6. **ALWAYS aim for maximum test coverage** (80-100% depending on criticality)

---

## 🔑 Permission Hierarchy (Specific Overrides General)

```typescript
@Restricted(RoleEnum.ADMIN)  // ← FALLBACK: DO NOT REMOVE
export class ProductController {
  @Roles(RoleEnum.S_USER)    // ← SPECIFIC: This method is more open
  async createProduct() { }   // ← S_USER can access (specific wins)

  async secretMethod() { }    // ← ADMIN only (fallback applies)
}
```

**Why class-level `@Restricted(ADMIN)` MUST stay:**
- If someone forgets `@Roles()` on a new method → it's secure by default
- Shows the class is security-sensitive
- Fail-safe protection

---

## Rule 1: NEVER Weaken Security for Test Convenience

### ❌ ABSOLUTELY FORBIDDEN

```typescript
// BEFORE (secure):
@Restricted(RoleEnum.ADMIN)
export class ProductController {
  @Roles(RoleEnum.S_USER)
  async createProduct() { ... }
}

// AFTER (FORBIDDEN - security weakened!):
// @Restricted(RoleEnum.ADMIN)  ← NEVER remove this!
export class ProductController {
  @Roles(RoleEnum.S_USER)
  async createProduct() { ... }
}
```

### 🚨 CRITICAL RULE

- **NEVER remove or weaken `@Restricted()` decorators** on Controllers, Resolvers, Models, or Objects
- **NEVER change `@Roles()` decorators** to more permissive roles just to make tests pass
- **NEVER modify `securityCheck()` logic** to bypass security for testing

### If tests fail due to permissions

1. ✅ **CORRECT**: Adjust the test to use the appropriate user/token
2. ✅ **CORRECT**: Create test users with the required roles
3. ❌ **WRONG**: Weaken security to make tests pass

### Any security changes MUST

- Be discussed with the developer FIRST
- Have a solid business justification
- Be explicitly approved by the developer
- Be documented with the reason

---

## Rule 2: Understanding Permission Hierarchy

### ⭐ Key Concept: Specific Overrides General

The `@Restricted()` decorator on a class acts as a **security fallback** - if a method/property doesn't specify permissions, it inherits the class-level restriction. This is a **security-by-default** pattern.

### Example - Controller/Resolver

```typescript
@Restricted(RoleEnum.ADMIN)  // ← FALLBACK: Protects everything by default
export class ProductController {

  @Roles(RoleEnum.S_EVERYONE)  // ← SPECIFIC: This method is MORE open
  async getPublicProducts() {
    // Anyone can access this (specific @Roles wins)
  }

  @Roles(RoleEnum.S_USER)  // ← SPECIFIC: Logged-in users
  async createProduct() {
    // S_USER can access (specific wins over fallback)
  }

  async deleteProduct() {
    // ADMIN ONLY (no specific decorator, fallback applies)
  }
}
```

### Example - Model

```typescript
@Restricted(RoleEnum.ADMIN)  // ← FALLBACK
export class Product {

  @Roles(RoleEnum.S_EVERYONE)  // ← SPECIFIC
  @UnifiedField({ description: 'Product name' })
  name: string;  // Everyone can read this

  @UnifiedField({ description: 'Internal cost' })
  cost: number;  // ADMIN ONLY (fallback applies)
}
```

---

## Rule 3: Adapt Tests to Security, Not Vice Versa

### ❌ WRONG Approach

```typescript
// Test fails because user isn't admin
it('should create product', async () => {
  const result = await request(app)
    .post('/products')
    .set('Authorization', regularUserToken)  // Not an admin!
    .send(productData);

  expect(result.status).toBe(201);  // Fails with 403
});

// ❌ WRONG FIX: Removing @Restricted from controller
// @Restricted(RoleEnum.ADMIN)  ← NEVER DO THIS!
```

### ✅ CORRECT Approach

```typescript
// Analyze first: Who is allowed to create products?
// Answer: ADMIN only (based on @Restricted on controller)

// Create admin test user
let adminToken: string;

beforeAll(async () => {
  const admin = await createTestUser({ roles: [RoleEnum.ADMIN] });
  adminToken = admin.token;
});

it('should create product as admin', async () => {
  const result = await request(app)
    .post('/products')
    .set('Authorization', adminToken)  // ✅ Use admin token
    .send(productData);

  expect(result.status).toBe(201);  // ✅ Passes
});

it('should reject product creation for regular user', async () => {
  const result = await request(app)
    .post('/products')
    .set('Authorization', regularUserToken)
    .send(productData);

  expect(result.status).toBe(403);  // ✅ Test security works!
});
```

---

## Rule 4: Test with Least Privileged User

**Always test with the LEAST privileged user who is authorized to perform the action.**

### ❌ WRONG

```typescript
// Method allows S_USER, but testing with ADMIN
@Roles(RoleEnum.S_USER)
async getProducts() { }

it('should get products', async () => {
  const result = await request(app)
    .get('/products')
    .set('Authorization', adminToken);  // ❌ Over-privileged!
});
```

### ✅ CORRECT

```typescript
@Roles(RoleEnum.S_USER)
async getProducts() { }

it('should get products as regular user', async () => {
  const result = await request(app)
    .get('/products')
    .set('Authorization', regularUserToken);  // ✅ Least privilege
});
```

**Why this matters:**
- Tests might pass with ADMIN but fail with S_USER
- You won't catch permission bugs
- False confidence in security

---

## Rule 5: Create Appropriate Test Users

**Create test users for EACH permission level you need to test.**

### Example Test Setup

```typescript
describe('ProductController', () => {
  let adminToken: string;
  let userToken: string;
  let everyoneToken: string;

  beforeAll(async () => {
    // Create admin user
    const admin = await createTestUser({
      roles: [RoleEnum.ADMIN]
    });
    adminToken = admin.token;

    // Create regular user
    const user = await createTestUser({
      roles: [RoleEnum.S_USER]
    });
    userToken = user.token;

    // Create unauthenticated scenario
    const guest = await createTestUser({
      roles: [RoleEnum.S_EVERYONE]
    });
    everyoneToken = guest.token;
  });

  it('admin can delete products', async () => {
    // Use adminToken
  });

  it('regular user can create products', async () => {
    // Use userToken
  });

  it('everyone can view products', async () => {
    // Use everyoneToken or no token
  });

  it('regular user cannot delete products', async () => {
    // Use userToken, expect 403
  });
});
```

---

## Rule 6: Comprehensive Test Coverage

**Aim for 80-100% test coverage depending on criticality:**

- **High criticality** (payments, user data, admin functions): 95-100%
- **Medium criticality** (business logic, CRUD): 80-90%
- **Low criticality** (utilities, formatters): 70-80%

### What to Test

**For each endpoint/method:**

1. ✅ Happy path (authorized user, valid data)
2. ✅ Permission denied (unauthorized user)
3. ✅ Validation errors (invalid input)
4. ✅ Edge cases (empty data, boundaries)
5. ✅ Error handling (server errors, missing resources)

### Example Comprehensive Tests

```typescript
describe('createProduct', () => {
  it('should create product with admin user', async () => {
    // Happy path
  });

  it('should reject creation by regular user', async () => {
    // Permission test
  });

  it('should reject invalid product data', async () => {
    // Validation test
  });

  it('should reject duplicate product name', async () => {
    // Business rule test
  });

  it('should handle missing required fields', async () => {
    // Edge case
  });
});
```

---

## Quick Security Checklist

Before completing ANY task:

- [ ] **All @Restricted decorators preserved**
- [ ] **@Roles decorators NOT made more permissive**
- [ ] **Tests use appropriate user roles**
- [ ] **Test users created for each permission level**
- [ ] **Least privileged user tested**
- [ ] **Permission denial tested (403 responses)**
- [ ] **No securityCheck() logic bypassed**
- [ ] **Test coverage ≥ 80%**
- [ ] **All edge cases covered**

---

## Security Decision Protocol

**When you encounter a security-related decision:**

1. **STOP** - Don't make the change immediately
2. **ANALYZE** - Why does the current security exist?
3. **ASK** - Consult the developer before changing
4. **DOCUMENT** - If approved, document the reason
5. **TEST** - Ensure security still works after change

**Remember:**
- **Security > Convenience**
- **Better to over-restrict than under-restrict**
- **Always preserve existing security mechanisms**
- **When in doubt, ask the developer**
