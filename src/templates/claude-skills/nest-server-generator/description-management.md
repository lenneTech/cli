---
name: nest-server-generator-description-management
version: 1.0.0
description: Guidelines for consistent description management across all generated components
---

# 🚨 CRITICAL: Description Management

**⚠️ COMMON MISTAKE:** Descriptions are often applied inconsistently or only partially. You MUST follow this process for EVERY component.

---

## 🔍 Step 1: ALWAYS Extract Descriptions from User Input

**BEFORE generating ANY code, scan the user's specification for description hints:**

1. **Look for comments after `//`**:
   ```
   Module: Product
   - name: string // Product name
   - price: number // Produktpreis
   - stock?: number // Current stock level
   ```

2. **Extract ALL comments** and store them for each property
3. **Identify language** (English or German)

---

## 📝 Step 2: Format Descriptions Correctly

**Rule**: `"ENGLISH_DESCRIPTION (DEUTSCHE_BESCHREIBUNG)"`

### Processing Logic

| User Input | Language | Formatted Description |
|------------|----------|----------------------|
| `// Product name` | English | `'Product name'` |
| `// Produktname` | German | `'Product name (Produktname)'` |
| `// Straße` | German | `'Street (Straße)'` |
| `// Postleizahl` (typo) | German | `'Postal code (Postleitzahl)'` |
| (no comment) | - | Create meaningful English description |

### ⚠️ CRITICAL - Preserving Original Text

**1. Fix spelling errors ONLY:**
- ✅ Correct typos: `Postleizahl` → `Postleitzahl` (missing 't')
- ✅ Fix character errors: `Starße` → `Straße` (wrong character)
- ✅ Correct English typos: `Prodcut name` → `Product name`

**2. DO NOT change the wording:**
- ❌ NEVER rephrase: `Straße` → `Straßenname` (NO!)
- ❌ NEVER expand: `Produkt` → `Produktbezeichnung` (NO!)
- ❌ NEVER improve: `Name` → `Full name` (NO!)
- ❌ NEVER translate differently: `Name` → `Title` (NO!)

**3. Why this is critical:**
- User comments may be **predefined terms** from requirements
- External systems may **reference these exact terms**
- Changing wording breaks **external integrations**

### Examples

```
✅ CORRECT:
// Straße → 'Street (Straße)'  (only translated)
// Starße → 'Street (Straße)'  (typo fixed, then translated)
// Produkt → 'Product (Produkt)'  (keep original word)
// Strasse → 'Street (Straße)'  (ss→ß corrected, then translated)

❌ WRONG:
// Straße → 'Street name (Straßenname)'  (changed wording!)
// Produkt → 'Product name (Produktname)'  (added word!)
// Name → 'Full name (Vollständiger Name)'  (rephrased!)
```

**Rule Summary**: Fix typos, preserve wording, translate accurately.

---

## ✅ Step 3: Apply Descriptions EVERYWHERE (Most Critical!)

**🚨 YOU MUST apply the SAME description to ALL of these locations:**

### For Module Properties

**1. Model file** (`<module>.model.ts`):
```typescript
@UnifiedField({ description: 'Product name (Produktname)' })
name: string;
```

**2. Create Input** (`<module>-create.input.ts`):
```typescript
@UnifiedField({ description: 'Product name (Produktname)' })
name: string;
```

**3. Update Input** (`<module>.input.ts`):
```typescript
@UnifiedField({ description: 'Product name (Produktname)' })
name?: string;
```

### For SubObject Properties

**1. Object file** (`<object>.object.ts`):
```typescript
@UnifiedField({ description: 'Street (Straße)' })
street: string;
```

**2. Object Create Input** (`<object>-create.input.ts`):
```typescript
@UnifiedField({ description: 'Street (Straße)' })
street: string;
```

**3. Object Update Input** (`<object>.input.ts`):
```typescript
@UnifiedField({ description: 'Street (Straße)' })
street?: string;
```

### For Object/Module Type Decorators

Apply descriptions to the class decorators as well:

```typescript
@ObjectType({ description: 'Address information (Adressinformationen)' })
export class Address { ... }

@InputType({ description: 'Address information (Adressinformationen)' })
export class AddressInput { ... }

@ObjectType({ description: 'Product entity (Produkt-Entität)' })
export class Product extends CoreModel { ... }
```

---

## ⛔ Common Mistakes to AVOID

1. ❌ **Partial application**: Descriptions only in Models, not in Inputs
2. ❌ **Inconsistent format**: German-only in some places, English-only in others
3. ❌ **Missing descriptions**: No descriptions when user provided comments
4. ❌ **Ignoring Object inputs**: Forgetting to add descriptions to SubObject Input files
5. ❌ **Wrong format**: Using `(ENGLISH)` instead of `ENGLISH (DEUTSCH)`
6. ❌ **Changing wording**: Rephrasing user's original terms
7. ❌ **Adding words**: Expanding user's terminology

---

## ✅ Verification Checklist

After generating code, ALWAYS verify:

- [ ] All user comments/descriptions extracted from specification
- [ ] All descriptions follow format: `"ENGLISH (DEUTSCH)"` or `"ENGLISH"`
- [ ] Model properties have descriptions
- [ ] Create Input properties have SAME descriptions
- [ ] Update Input properties have SAME descriptions
- [ ] Object properties have descriptions
- [ ] Object Input properties have SAME descriptions
- [ ] Class-level `@ObjectType()` and `@InputType()` have descriptions
- [ ] NO German-only descriptions (must be translated)
- [ ] NO inconsistencies between files
- [ ] Original wording preserved (only typos fixed)

---

## 🔄 If You Forget

**If you generate code and realize descriptions are missing or inconsistent:**

1. **STOP** - Don't continue with other phases
2. **Go back** and add/fix ALL descriptions
3. **Verify** using the checklist above
4. **Then continue** with remaining phases

**Remember**: Descriptions are NOT optional "nice-to-have" - they are MANDATORY for:
- API documentation (Swagger/GraphQL)
- Code maintainability
- Developer experience
- Bilingual projects (German/English teams)

---

## Quick Reference

### Format Rules

```
English input    → 'Product name'
German input     → 'Product name (Produktname)'
No input         → Create meaningful description
Typo input       → Fix typo, then translate
Mixed input      → Standardize to 'ENGLISH (DEUTSCH)'
```

### Application Checklist

For **each property**:
- [ ] Model file
- [ ] Create Input file
- [ ] Update Input file

For **each class**:
- [ ] @ObjectType() decorator
- [ ] @InputType() decorator (if applicable)

### Remember

- **Consistency is critical** - Same description everywhere
- **Preserve wording** - Only fix typos, never rephrase
- **Bilingual format** - Always use "ENGLISH (DEUTSCH)" for German terms
- **Verification** - Check all files before proceeding
