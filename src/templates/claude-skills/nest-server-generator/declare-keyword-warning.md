---
name: nest-server-generator-declare-keyword
version: 1.0.0
description: Critical warning about using the declare keyword in TypeScript classes
---

# 🚨 CRITICAL: NEVER USE `declare` KEYWORD FOR PROPERTIES

**⚠️ IMPORTANT RULE: DO NOT use the `declare` keyword when defining properties in classes!**

The `declare` keyword in TypeScript signals that a property is only a type declaration without a runtime value. This prevents decorators from being properly applied and overridden.

---

## ❌ WRONG - Using `declare`

```typescript
export class ProductCreateInput extends ProductInput {
  declare name: string;  // ❌ WRONG - Decorator won't be applied!
  declare price: number; // ❌ WRONG - Decorator won't be applied!
}
```

---

## ✅ CORRECT - Without `declare`

```typescript
export class ProductCreateInput extends ProductInput {
  @UnifiedField({ description: 'Product name' })
  name: string;  // ✅ CORRECT - Decorator works properly

  @UnifiedField({ description: 'Product price' })
  price: number; // ✅ CORRECT - Decorator works properly
}
```

---

## Why This Matters

1. **Decorators require actual properties**: `@UnifiedField()`, `@Restricted()`, and other decorators need actual property declarations to attach metadata
2. **Override behavior**: When extending classes, using `declare` prevents decorators from being properly overridden
3. **Runtime behavior**: `declare` properties don't exist at runtime, breaking the decorator system

---

## When You Might Be Tempted to Use `declare`

- ❌ When extending a class and wanting to change a decorator
- ❌ When TypeScript shows "property is declared but never used"
- ❌ When dealing with inheritance and property redefinition

---

## Correct Approach Instead

Use the `override` keyword (when appropriate) but NEVER `declare`:

```typescript
export class ProductCreateInput extends ProductInput {
  // ✅ Use override when useDefineForClassFields is enabled
  override name: string;

  // ✅ Apply decorators directly - they will override parent decorators
  @UnifiedField({ description: 'Product name', isOptional: false })
  override price: number;
}
```

---

## Examples

### ❌ WRONG - Using declare

```typescript
// This will BREAK decorator functionality
export class AddressInput extends Address {
  declare street: string;
  declare city: string;
  declare zipCode: string;
}
```

### ✅ CORRECT - Without declare

```typescript
// This works properly
export class AddressInput extends Address {
  @UnifiedField({ description: 'Street' })
  street: string;

  @UnifiedField({ description: 'City' })
  city: string;

  @UnifiedField({ description: 'Zip code' })
  zipCode: string;
}
```

### ✅ CORRECT - With override

```typescript
// This also works when extending decorated properties
export class AddressInput extends Address {
  @UnifiedField({ description: 'Street', isOptional: false })
  override street: string;

  @UnifiedField({ description: 'City', isOptional: false })
  override city: string;

  @UnifiedField({ description: 'Zip code', isOptional: true })
  override zipCode?: string;
}
```

---

## Remember

**`declare` = no decorators = broken functionality!**

Always use actual property declarations with decorators, optionally with the `override` keyword when extending classes.
