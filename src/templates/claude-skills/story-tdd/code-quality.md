---
name: story-tdd-code-quality
version: 1.0.0
description: Code quality and refactoring guidelines for Test-Driven Development
---

# Code Quality & Refactoring Check

**BEFORE marking the task as complete, perform a code quality review!**

Once all tests are passing, analyze your implementation for code quality issues.

---

## 1. Check for Code Duplication

**Identify redundant code patterns:**
- Repeated logic in multiple methods
- Similar code blocks with minor variations
- Duplicated validation logic
- Repeated data transformations
- Multiple similar helper functions

**Example of code duplication:**

```typescript
// ❌ BAD: Duplicated validation logic
async createProduct(input: ProductInput) {
  if (!input.name || input.name.trim().length === 0) {
    throw new BadRequestException('Name is required');
  }
  if (!input.price || input.price <= 0) {
    throw new BadRequestException('Price must be positive');
  }
  // ... create product
}

async updateProduct(id: string, input: ProductInput) {
  if (!input.name || input.name.trim().length === 0) {
    throw new BadRequestException('Name is required');
  }
  if (!input.price || input.price <= 0) {
    throw new BadRequestException('Price must be positive');
  }
  // ... update product
}

// ✅ GOOD: Extracted to reusable function
private validateProductInput(input: ProductInput) {
  if (!input.name || input.name.trim().length === 0) {
    throw new BadRequestException('Name is required');
  }
  if (!input.price || input.price <= 0) {
    throw new BadRequestException('Price must be positive');
  }
}

async createProduct(input: ProductInput) {
  this.validateProductInput(input);
  // ... create product
}

async updateProduct(id: string, input: ProductInput) {
  this.validateProductInput(input);
  // ... update product
}
```

---

## 2. Extract Common Functionality

**Look for opportunities to create helper functions:**
- Data transformation logic
- Validation logic
- Query building
- Response formatting
- Common calculations

**Example of extracting common functionality:**

```typescript
// ❌ BAD: Repeated price calculation logic
async createOrder(input: OrderInput) {
  let totalPrice = 0;
  for (const item of input.items) {
    const product = await this.productService.findById(item.productId);
    totalPrice += product.price * item.quantity;
  }
  // ... create order
}

async estimateOrderPrice(items: OrderItem[]) {
  let totalPrice = 0;
  for (const item of items) {
    const product = await this.productService.findById(item.productId);
    totalPrice += product.price * item.quantity;
  }
  return totalPrice;
}

// ✅ GOOD: Extracted to reusable helper
private async calculateOrderTotal(items: OrderItem[]): Promise<number> {
  let totalPrice = 0;
  for (const item of items) {
    const product = await this.productService.findById(item.productId);
    totalPrice += product.price * item.quantity;
  }
  return totalPrice;
}

async createOrder(input: OrderInput) {
  const totalPrice = await this.calculateOrderTotal(input.items);
  // ... create order
}

async estimateOrderPrice(items: OrderItem[]) {
  return this.calculateOrderTotal(items);
}
```

---

## 3. Consolidate Similar Code Paths

**Identify code paths that can be unified:**
- Methods with similar logic but different parameters
- Conditional branches that can be combined
- Similar error handling patterns

**Example of consolidating code paths:**

```typescript
// ❌ BAD: Similar methods with duplicated logic
async findProductsByCategory(category: string) {
  return this.find({
    where: { category },
    relations: ['reviews', 'supplier'],
    order: { createdAt: 'DESC' },
  });
}

async findProductsBySupplier(supplierId: string) {
  return this.find({
    where: { supplierId },
    relations: ['reviews', 'supplier'],
    order: { createdAt: 'DESC' },
  });
}

async findProductsByPriceRange(minPrice: number, maxPrice: number) {
  return this.find({
    where: { price: Between(minPrice, maxPrice) },
    relations: ['reviews', 'supplier'],
    order: { createdAt: 'DESC' },
  });
}

// ✅ GOOD: Unified method with flexible filtering
async findProducts(filters: {
  category?: string;
  supplierId?: string;
  priceRange?: { min: number; max: number };
}) {
  const where: any = {};

  if (filters.category) {
    where.category = filters.category;
  }

  if (filters.supplierId) {
    where.supplierId = filters.supplierId;
  }

  if (filters.priceRange) {
    where.price = Between(filters.priceRange.min, filters.priceRange.max);
  }

  return this.find({
    where,
    relations: ['reviews', 'supplier'],
    order: { createdAt: 'DESC' },
  });
}
```

---

## 4. Review for Consistency

**Ensure consistent patterns throughout your implementation:**
- Naming conventions match existing codebase
- Error handling follows project patterns
- Return types are consistent
- Similar operations use similar approaches

---

## 5. Refactoring Decision Tree

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

---

## 6. Run Tests After Refactoring

**CRITICAL: After any refactoring:**

```bash
npm test
```

**Ensure:**
- ✅ All tests still pass
- ✅ No new failures introduced
- ✅ Code is more maintainable
- ✅ No functionality changed

---

## 7. When to Skip Refactoring

**Don't refactor if:**
- Code is used in only ONE place
- Extraction would make code harder to understand
- The duplication is coincidental, not conceptual
- Time constraints don't allow for safe refactoring

**Remember:**
- **Working code > Perfect code**
- **Refactor only if it improves maintainability**
- **Always run tests after refactoring**

---

## Quick Code Quality Checklist

Before marking complete:

- [ ] **No obvious code duplication**
- [ ] **Common functionality extracted to helpers**
- [ ] **Consistent patterns throughout**
- [ ] **Code follows existing patterns**
- [ ] **Proper error handling**
- [ ] **Tests still pass after refactoring**
