---
name: story-tdd-security-review
version: 1.0.0
description: Security review checklist for Test-Driven Development - ensures no vulnerabilities are introduced
---

# 🔐 Security Review Checklist

## Table of Contents
- [Security Checklist](#security-checklist)
- [Security Decision Tree](#security-decision-tree)
- [Red Flags - STOP and Review](#red-flags---stop-and-review)
- [If ANY Red Flag Found](#if-any-red-flag-found)
- [Remember](#remember)
- [Quick Security Checklist](#quick-security-checklist)

**CRITICAL: Perform security review before final testing!**

**ALWAYS review all code changes for security vulnerabilities before marking complete.**

Security issues can be introduced during implementation without realizing it. A systematic review prevents:
- Unauthorized access to data
- Privilege escalation
- Data leaks
- Injection attacks
- Authentication bypasses

---

## Security Checklist

### 1. Authentication & Authorization

✅ **Check decorators are NOT weakened:**

```typescript
// ❌ WRONG: Removing security to make tests pass
// OLD:
@Restricted(RoleEnum.ADMIN)
async deleteUser(id: string) { ... }

// NEW (DANGEROUS):
async deleteUser(id: string) { ... }  // ⚠️ No restriction!

// ✅ CORRECT: Keep or strengthen security
@Restricted(RoleEnum.ADMIN)
async deleteUser(id: string) { ... }
```

✅ **Verify @Roles decorators:**

```typescript
// ❌ WRONG: Making endpoint too permissive
@Roles(RoleEnum.S_USER)  // Everyone can delete!
async deleteOrder(id: string) { ... }

// ✅ CORRECT: Proper role restriction
@Roles(RoleEnum.ADMIN)  // Only admins can delete
async deleteOrder(id: string) { ... }
```

✅ **Check ownership verification:**

```typescript
// ❌ WRONG: No ownership check
async updateProfile(userId: string, data: UpdateProfileInput, currentUser: User) {
  return this.userService.update(userId, data);  // Any user can update any profile!
}

// ✅ CORRECT: Verify ownership or admin role
async updateProfile(userId: string, data: UpdateProfileInput, currentUser: User) {
  // Check if user is updating their own profile or is admin
  if (userId !== currentUser.id && !currentUser.roles.includes(RoleEnum.ADMIN)) {
    throw new ForbiddenException('Cannot update other users');
  }
  return this.userService.update(userId, data);
}
```

### 2. Input Validation

✅ **Verify all inputs are validated:**

```typescript
// ❌ WRONG: No validation
async createProduct(input: any) {
  return this.productService.create(input);  // Dangerous!
}

// ✅ CORRECT: Proper DTO with validation
export class CreateProductInput {
  @UnifiedField({
    description: 'Product name',
    isOptional: false,
    mongoose: { type: String, required: true, minlength: 1, maxlength: 100 }
  })
  name: string;

  @UnifiedField({
    description: 'Price',
    isOptional: false,
    mongoose: { type: Number, required: true, min: 0 }
  })
  price: number;
}
```

✅ **Check for injection vulnerabilities:**

```typescript
// ❌ WRONG: Direct string interpolation in queries
async findByName(name: string) {
  return this.productModel.find({ $where: `this.name === '${name}'` });  // SQL Injection!
}

// ✅ CORRECT: Parameterized queries
async findByName(name: string) {
  return this.productModel.find({ name });  // Safe
}
```

### 3. Data Exposure

✅ **Verify sensitive data is protected:**

```typescript
// ❌ WRONG: Exposing passwords
export class User {
  @UnifiedField({ description: 'Email' })
  email: string;

  @UnifiedField({ description: 'Password' })
  password: string;  // ⚠️ Will be exposed in API!
}

// ✅ CORRECT: Hide sensitive fields
export class User {
  @UnifiedField({ description: 'Email' })
  email: string;

  @UnifiedField({
    description: 'Password hash',
    hideField: true,  // ✅ Never expose in API
    mongoose: { type: String, required: true }
  })
  password: string;
}
```

✅ **Check error messages don't leak data:**

```typescript
// ❌ WRONG: Exposing sensitive info in errors
catch (error) {
  throw new BadRequestException(`Query failed: ${error.message}, SQL: ${query}`);
}

// ✅ CORRECT: Generic error messages
catch (error) {
  this.logger.error(`Query failed: ${error.message}`, error.stack);
  throw new BadRequestException('Invalid request');
}
```

### 4. Authorization in Services

✅ **Verify service methods check permissions:**

```typescript
// ❌ WRONG: Service doesn't check who can access
async getOrder(orderId: string) {
  return this.orderModel.findById(orderId);  // Anyone can see any order!
}

// ✅ CORRECT: Service checks ownership or role
async getOrder(orderId: string, currentUser: User) {
  const order = await this.orderModel.findById(orderId);

  // Check if user owns the order or is admin
  if (order.customerId !== currentUser.id && !currentUser.roles.includes(RoleEnum.ADMIN)) {
    throw new ForbiddenException('Access denied');
  }

  return order;
}
```

### 5. Security Model Checks

✅ **Verify checkSecurity methods:**

```typescript
// In model file
async checkSecurity(user: User, mode: SecurityMode): Promise<void> {
  // ❌ WRONG: No security check
  return;

  // ✅ CORRECT: Proper security implementation
  if (mode === SecurityMode.CREATE && !user.roles.includes(RoleEnum.ADMIN)) {
    throw new ForbiddenException('Only admins can create');
  }

  if (mode === SecurityMode.UPDATE && this.createdBy !== user.id && !user.roles.includes(RoleEnum.ADMIN)) {
    throw new ForbiddenException('Can only update own items');
  }
}
```

### 6. Cross-Cutting Concerns

✅ **Rate limiting for sensitive endpoints:**
- Password reset endpoints
- Authentication endpoints
- Payment processing
- Email sending

✅ **HTTPS/TLS enforcement (production)**

✅ **Proper CORS configuration**

✅ **No hardcoded secrets or API keys**

---

## Security Decision Tree

```
Code changes made?
    │
    ├─► Modified @Restricted or @Roles?
    │   └─► ⚠️ CRITICAL: Verify this was intentional and justified
    │
    ├─► New endpoint added?
    │   └─► ✅ Ensure proper authentication + authorization decorators
    │
    ├─► Service method modified?
    │   └─► ✅ Verify ownership checks still in place
    │
    ├─► New input/query parameters?
    │   └─► ✅ Ensure validation and sanitization
    │
    └─► Sensitive data accessed?
        └─► ✅ Verify access control and data hiding
```

---

## Red Flags - STOP and Review

🚩 **Authentication/Authorization:**
- @Restricted decorator removed or changed
- @Roles changed to more permissive role
- Endpoints without authentication
- Missing ownership checks

🚩 **Data Security:**
- Sensitive fields not marked with hideField
- Password or token fields exposed
- User data accessible without permission check
- Error messages revealing internal details

🚩 **Input Validation:**
- Missing validation decorators
- Any type used instead of DTO
- Direct use of user input in queries
- No sanitization of string inputs

🚩 **Business Logic:**
- Bypassing security checks "for convenience"
- Commented out authorization code
- Admin-only actions available to regular users
- Price/amount manipulation possible

---

## If ANY Red Flag Found

1. **STOP implementation**
2. **Fix the security issue immediately**
3. **Review surrounding code for similar issues**
4. **Re-run security checklist**
5. **Update tests to verify security works**

---

## Remember

- **Security > Convenience**
- **Better to over-restrict than under-restrict**
- **Always preserve existing security mechanisms**
- **When in doubt, ask the developer**

---

## Quick Security Checklist

Before marking complete:

- [ ] **@Restricted/@Roles decorators NOT removed or weakened**
- [ ] **Ownership checks in place (users can only access own data)**
- [ ] **All inputs validated with proper DTOs**
- [ ] **Sensitive fields marked with hideField: true**
- [ ] **No SQL/NoSQL injection vulnerabilities**
- [ ] **Error messages don't expose sensitive data**
- [ ] **checkSecurity methods implemented in models**
- [ ] **Authorization tests pass**
- [ ] **No hardcoded secrets or credentials**
