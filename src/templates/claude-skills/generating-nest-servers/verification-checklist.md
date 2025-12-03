---
name: nest-server-generator-verification
version: 1.0.0
description: Comprehensive verification checklist for generated NestJS modules and objects - covers code generation, descriptions, API tests with security-first approach, test coverage requirements, and security rules compliance
---

# Verification Checklist

## Table of Contents
- [Code Generation](#code-generation)
- [API Tests - Security First](#api-tests---security-first)
- [Test Coverage - Comprehensive Testing](#test-coverage---comprehensive-testing)
- [Security Rules Compliance](#security-rules-compliance)
- [Test Organization Structure](#test-organization-structure)
- [Quick Verification Workflow](#quick-verification-workflow)
- [Common Verification Failures](#common-verification-failures)
- [Success Criteria](#success-criteria)

After generation, verify all items in this comprehensive checklist:

## Code Generation

- [ ] All SubObjects created
- [ ] All Objects created
- [ ] All Modules created
- [ ] All properties in alphabetical order
- [ ] **DESCRIPTIONS (Critical - check thoroughly):**
  - [ ] All user-provided comments (after `//`) extracted from specification
  - [ ] All German descriptions translated to format: `ENGLISH (DEUTSCH)`
  - [ ] All English descriptions kept as-is (spelling corrected)
  - [ ] ALL Module Models have descriptions on all properties
  - [ ] ALL Module CreateInputs have SAME descriptions
  - [ ] ALL Module UpdateInputs have SAME descriptions
  - [ ] ALL SubObjects have descriptions on all properties
  - [ ] ALL SubObject CreateInputs have SAME descriptions
  - [ ] ALL SubObject UpdateInputs have SAME descriptions
  - [ ] ALL `@ObjectType()` decorators have descriptions
  - [ ] ALL `@InputType()` decorators have descriptions
  - [ ] NO inconsistencies (same property, different descriptions in different files)
  - [ ] NO German-only descriptions (must be translated)
- [ ] Inheritance properly implemented
- [ ] Required fields correctly set in CreateInputs
- [ ] Enum files created in `src/server/common/enums/`

---

## API Tests - Security First

**🚨 CRITICAL: Security analysis MUST be completed BEFORE writing ANY test!**

### Permission Analysis (BEFORE Writing Tests)
- [ ] **Permission analysis completed BEFORE writing tests**
- [ ] **Analyzed ALL `@Roles()` decorators in controllers/resolvers**
- [ ] **Read complete `securityCheck()` method in models**
- [ ] **Understood permission hierarchy (specific overrides general)**

### Test User Matrix (Principle of Least Privilege)
- [ ] **Tests use LEAST privileged user (never admin when less works)**
- [ ] **S_EVERYONE endpoints tested WITHOUT token**
- [ ] **S_USER endpoints tested with REGULAR user (not admin)**
- [ ] **UPDATE/DELETE tested with CREATOR token (not admin)**

### Security Validation Tests (MANDATORY)
- [ ] **Tests verify unauthorized access FAILS (401/403)**
- [ ] **Tests verify non-creators CANNOT update/delete**
- [ ] **Tests verify required fields**
- [ ] **Security validation tests exist (permission failures)**

### General Test Requirements
- [ ] API tests created for all modules
- [ ] Tests cover all CRUD operations
- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] Lint passes

---

## Test Coverage - Comprehensive Testing

**🎯 GOAL: Achieve the HIGHEST possible test coverage**

### Functional Coverage
- [ ] **Every endpoint has at least one successful test**
- [ ] **Every endpoint has at least one failure test (unauthorized/validation)**
- [ ] **All query parameters tested (filters, sorting, pagination)**
- [ ] **All validation rules tested (required fields, min/max, patterns)**
- [ ] **All relationships tested (creating/updating/deleting with references)**
- [ ] **Edge cases tested (empty results, non-existent IDs, duplicate values)**
- [ ] **Error handling tested (400, 401, 403, 404, 409 status codes)**
- [ ] **Data integrity tested (cascading deletes, orphan prevention)**
- [ ] **Business logic tested (custom methods, computed properties)**
- [ ] **Performance tested (large datasets, pagination limits)**

### Coverage Requirements
- Minimum 80% line coverage for services
- Minimum 90% line coverage for resolvers/controllers
- 100% coverage for critical security logic (securityCheck, permission guards)
- 100% coverage for all endpoints (success AND failure cases)
- 100% coverage for all permission combinations
- All public methods tested
- All error paths tested

---

## Security Rules Compliance

**🚨 CRITICAL: These MUST be checked before completing**

### Security Decorator Rules
- [ ] **NO `@Restricted()` decorators removed from Controllers/Resolvers/Models/Objects**
- [ ] **NO `@Roles()` decorators weakened to make tests pass**
- [ ] **NO `securityCheck()` logic modified to bypass security**
- [ ] **Class-level `@Restricted(ADMIN)` kept as security fallback**

### Security Change Management
- [ ] **All security changes discussed and approved by developer**
- [ ] **All security changes documented with approval and reason**
- [ ] **Tests adapted to security requirements (not vice versa)**

### Test User Management
- [ ] **Appropriate test users created for each permission level**
- [ ] **Permission hierarchy understood and respected (specific overrides general)**

---

## Test Organization Structure

Use this structure for comprehensive, organized tests:

```typescript
describe('ProductResolver', () => {
  // Setup
  describe('Setup', () => {
    beforeAll(async () => {
      // Initialize test environment
      // Create test users with different roles
    });

    afterAll(async () => {
      // Cleanup all test data
    });
  });

  // Happy path tests
  describe('CREATE operations', () => {
    it('should create product as regular user', ...);
    it('should create product with all optional fields', ...);
    it('should create product with relationships', ...);
  });

  describe('READ operations', () => {
    it('should get product by ID', ...);
    it('should list all products with pagination', ...);
    it('should filter products by criteria', ...);
    it('should sort products by field', ...);
  });

  describe('UPDATE operations', () => {
    it('should update product as creator', ...);
    it('should update product as admin', ...);
    it('should update with partial data', ...);
  });

  describe('DELETE operations', () => {
    it('should delete product as creator', ...);
    it('should delete product as admin', ...);
    it('should handle cascading deletes', ...);
  });

  // Security tests (MANDATORY)
  describe('Security Validation', () => {
    it('should FAIL to create without auth', ...);
    it('should FAIL to update as non-creator', ...);
    it('should FAIL to delete as non-creator', ...);
    it('should FAIL to access with invalid token', ...);
    it('should FAIL to read private data as different user', ...);
  });

  // Validation tests
  describe('Input Validation', () => {
    it('should FAIL with missing required fields', ...);
    it('should FAIL with invalid field values', ...);
    it('should FAIL with duplicate values', ...);
    it('should FAIL with invalid references', ...);
  });

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle non-existent ID (404)', ...);
    it('should handle empty list results', ...);
    it('should handle concurrent updates', ...);
    it('should handle circular references', ...);
  });
});
```

---

## Quick Verification Workflow

1. **Code Generation:**
   - Run through all Code Generation checkboxes
   - Pay special attention to DESCRIPTIONS - most common error!

2. **API Tests - Security First:**
   - Complete Permission Analysis BEFORE writing tests
   - Create appropriate test users
   - Write security validation tests FIRST
   - Then write functional tests

3. **Test Coverage:**
   - Review coverage report
   - Add tests for any uncovered code
   - Aim for 90%+ overall coverage

4. **Security Rules:**
   - Double-check no decorators were removed
   - Verify all security changes documented
   - Confirm tests adapted to security (not vice versa)

5. **Final Validation:**
   - Run all tests: `npm test`
   - Check TypeScript: `npm run build`
   - Run linter: `npm run lint`

---

## Common Verification Failures

### ❌ Missing Descriptions
**Problem:** Forgot to add descriptions to CreateInput or UpdateInput
**Fix:** Add SAME description from Model to ALL Input files

### ❌ Wrong Test Privileges
**Problem:** Using admin token when S_USER would work
**Fix:** Review @Roles decorator, use least privileged user

### ❌ Missing Security Tests
**Problem:** No tests for unauthorized access
**Fix:** Add describe('Security Validation') block with 401/403 tests

### ❌ Inconsistent Descriptions
**Problem:** Different descriptions for same property in different files
**Fix:** Standardize to one description across Model + CreateInput + UpdateInput

### ❌ Security Decorator Removed
**Problem:** Removed @Restricted to make test pass
**Fix:** Keep decorator, fix test to use proper authentication

---

## Success Criteria

✅ **All checkboxes checked**
✅ **All tests pass**
✅ **No TypeScript errors**
✅ **Lint passes**
✅ **Coverage > 90%**
✅ **Security rules maintained**
✅ **Descriptions consistent**

**When all criteria met → Generation complete! 🎉**
