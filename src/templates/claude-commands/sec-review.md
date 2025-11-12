---
description: Perform security review of code changes
---

Perform a complete security review:

## 🔐 1. Controller/Resolver Security

Check all modified Controller/Resolver files:
- [ ] Were @Restricted decorators removed or weakened?
- [ ] Were @Roles decorators made more permissive?
- [ ] Are there new endpoints without security decorators?
- [ ] Are the roles appropriate (not too open)?

## 🔐 2. Model Security

Check all modified Model files:
- [ ] Is securityCheck() method correctly implemented?
- [ ] Admin check: `user?.hasRole(RoleEnum.ADMIN)`
- [ ] Creator check: `equalIds(user, this.createdBy)`
- [ ] Were security checks weakened?
- [ ] Are sensitive properties protected with @Restricted?

## 🔐 3. Input Validation

Check all Input/DTO files:
- [ ] Are all inputs validated?
- [ ] Required fields correctly marked?
- [ ] Type safety ensured?
- [ ] No unsafe data types (e.g., any)?

## 🔐 4. Ownership & Authorization

Check service methods:
- [ ] Update/Delete: Ownership checks present?
- [ ] Check: `userId === object.createdBy` OR `user.isAdmin`
- [ ] serviceOptions.roles correctly set?
- [ ] No authorization bypasses?

## 🔐 5. Data Exposure

Check GraphQL/REST responses:
- [ ] Sensitive fields marked with `hideField: true`?
- [ ] Passwords/Tokens not in responses?
- [ ] securityCheck() filters correctly?

## 🔐 6. Test Coverage

Check tests:
- [ ] Security failure tests present (403 responses)?
- [ ] Tests with different roles (Admin, User, Other)?
- [ ] Ownership tests present?

## 📋 Report

Create a list of all findings:
- **Critical**: Severe security issues
- **Warning**: Potential problems
- **Info**: Improvement suggestions
- **OK**: Everything secure

**On Critical/Warning findings: STOP and inform the developer!**
