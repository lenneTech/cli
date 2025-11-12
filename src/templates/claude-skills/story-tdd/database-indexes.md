---
name: story-tdd-database-indexes
version: 1.0.0
description: Database index guidelines for @UnifiedField decorator - keep indexes visible with properties
---

# 🔍 Database Indexes with @UnifiedField

**IMPORTANT: Always define indexes directly in the @UnifiedField decorator!**

This keeps indexes visible right where properties are defined, making them easy to spot during code reviews.

---

## When to Add Indexes

- ✅ Fields used in queries (find, filter, search)
- ✅ Foreign keys (references to other collections)
- ✅ Fields used in sorting operations
- ✅ Unique constraints (email, username, etc.)
- ✅ Fields frequently accessed together (compound indexes)

---

## Example Patterns

### Single Field Index

```typescript
@UnifiedField({
  description: 'User email address',
  mongoose: { index: true, unique: true, type: String }  // ✅ Simple index + unique constraint
})
email: string;
```

### Compound Index

```typescript
@UnifiedField({
  description: 'Product category',
  mongoose: { index: true, type: String }  // ✅ Part of compound index
})
category: string;

@UnifiedField({
  description: 'Product status',
  mongoose: { index: true, type: String }  // ✅ Part of compound index
})
status: string;

// Both fields indexed individually for flexible querying
```

### Text Index for Search

```typescript
@UnifiedField({
  description: 'Product name',
  mongoose: { type: String, text: true }  // ✅ Full-text search index
})
name: string;
```

### Foreign Key Index

```typescript
@UnifiedField({
  description: 'Reference to user who created this',
  mongoose: { index: true, type: String }  // ✅ Index for JOIN operations
})
createdBy: string;
```

---

## ⚠️ DON'T Create Indexes Separately!

```typescript
// ❌ WRONG: Separate schema index definition
@Schema()
export class Product {
  @UnifiedField({
    description: 'Category',
    mongoose: { type: String }
  })
  category: string;
}

ProductSchema.index({ category: 1 }); // ❌ Index hidden away from property

// ✅ CORRECT: Index in decorator mongoose option
@Schema()
export class Product {
  @UnifiedField({
    description: 'Category',
    mongoose: { index: true, type: String }  // ✅ Immediately visible
  })
  category: string;
}
```

---

## Benefits of Decorator-Based Indexes

- ✅ Indexes visible when reviewing properties
- ✅ No need to search schema files
- ✅ Clear documentation of query patterns
- ✅ Easier to maintain and update
- ✅ Self-documenting code

---

## Index Verification Checklist

**Look for fields that should have indexes:**
- Fields used in find/filter operations
- Foreign keys (userId, productId, etc.)
- Fields used in sorting (createdAt, updatedAt, name)
- Unique fields (email, username, slug)

**Example check:**

```typescript
// Service has this query:
const orders = await this.orderService.find({
  where: { customerId: userId, status: 'pending' }
});

// ✅ Model should have indexes:
export class Order {
  @UnifiedField({
    description: 'Customer reference',
    mongoose: { index: true, type: String }  // ✅ Used in queries
  })
  customerId: string;

  @UnifiedField({
    description: 'Order status',
    mongoose: { index: true, type: String }  // ✅ Used in filtering
  })
  status: string;
}
```

---

## Red Flags - Missing Indexes

🚩 **Check for these issues:**
- Service queries a field but model has no index
- Foreign key fields without index
- Unique constraints not marked in decorator
- Fields used in sorting without index

**If indexes are missing:**
1. Add them to the @UnifiedField decorator immediately
2. Re-run tests to ensure everything still works
3. Document why the index is needed (query pattern)

---

## Quick Index Checklist

Before marking complete:

- [ ] **Fields used in find() queries have indexes**
- [ ] **Foreign keys (userId, productId, etc.) have indexes**
- [ ] **Unique fields (email, username) marked with unique: true**
- [ ] **Fields used in sorting have indexes**
- [ ] **All indexes in @UnifiedField decorator (NOT separate schema)**
- [ ] **Indexes match query patterns in services**
