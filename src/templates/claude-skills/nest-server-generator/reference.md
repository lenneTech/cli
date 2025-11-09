---
name: nest-server-generator-reference
version: 1.0.1
description: Quick reference for ALL NestJS server development - from simple single commands to complex structure generation
---

# NestJS Server Development Quick Reference

## Scope

**This skill handles ALL NestJS server development tasks:**
- ✅ Simple: Create single module, object, or add property
- ✅ Complex: Generate complete server structures from specifications
- ✅ Any `lt server` command

Use this skill for **ANY** NestJS/nest-server work, no matter how simple or complex.

## Specification Syntax

### Component Types

| Type | Syntax | Purpose |
|------|--------|---------|
| **SubObject** | `SubObject: Name // Desc` | Embedded data structure (no _id, no timestamps) |
| **Object** | `Object: Name\nProperties:\n- prop: type` | Base model for inheritance |
| **Module** | `Module: Name\nModel: Name\n- prop: type` | Full CRUD module with API |

### Property Syntax

| Pattern | Meaning | LT CLI Flag |
|---------|---------|-------------|
| `name: string` | Required string | `--prop-name-X name --prop-type-X string` |
| `age?: number` | Optional number | `--prop-name-X age --prop-type-X number --prop-nullable-X true` |
| `tags: string[]` | Array of strings | `--prop-name-X tags --prop-type-X string --prop-array-X true` |
| `status: ENUM (A, B)` | Enum property | `--prop-name-X status --prop-enum-X StatusEnum` |
| `owner: User` | Reference to module | `--prop-name-X owner --prop-type-X ObjectId --prop-reference-X User` |
| `address: Address` | Embedded object | `--prop-name-X address --prop-schema-X Address` |
| `items: Item[]` | Array of objects | `--prop-name-X items --prop-schema-X Item --prop-array-X true` |
| `doc: File` | File reference | `--prop-name-X doc --prop-type-X string` |

### Type Mapping

| Spec Type | TypeScript | MongoDB | CLI Type |
|-----------|-----------|---------|----------|
| `string` | string | String | string |
| `number` | number | Number | number |
| `boolean` | boolean | Boolean | boolean |
| `Date` | Date | Date | Date |
| `bigint` | bigint | Long | bigint |
| `File` | string | String | string |
| `ENUM(...)` | XxxEnum | String/Number | (use --prop-enum-X) |
| `OtherModule` | ObjectId ref | ObjectId | ObjectId + reference |
| `SubObject` | Embedded | Object | (use --prop-schema-X) |

## Execution Workflow

### Phase Checklist

```
☐ 1. Parse specification completely
☐ 2. Create comprehensive todo list
☐ 3. Create all SubObjects (dependency order)
☐ 4. Create all Objects
☐ 5. Create all Modules (dependency order)
☐ 6. Handle inheritance (manual edits)
☐ 7. Update ALL descriptions EVERYWHERE (CRITICAL!)
    ☐ 7.1. Extract ALL user comments (after //) from specification
    ☐ 7.2. Format descriptions: ENGLISH (DEUTSCH)
    ☐ 7.3. Apply to ALL Module files (Model, CreateInput, UpdateInput)
    ☐ 7.4. Apply to ALL SubObject files (Object, CreateInput, UpdateInput)
    ☐ 7.5. Add to ALL class decorators (@ObjectType, @InputType)
    ☐ 7.6. Verify consistency (same property = same description)
☐ 8. Alphabetize all properties
☐ 9. Create enum files
☐ 10. Create API tests
☐ 11. Run tests
☐ 12. Verify & provide summary
```

### Dependency Order

```
1. SubObjects (if A uses B, create B first)
2. Objects (base models)
3. Modules (if A references B, create B first)
4. Circular refs (use addProp for second reference)
5. Inheritance updates
6. Enums
7. Tests
```

## Command Quick Reference

### Create New Server
```bash
lt server create <server-name>
# Alias: lt server c <server-name>

# Example
lt server create my-api
```

**What it does**:
- Clones nest-server-starter template
- Configures package.json
- Sets up Swagger docs
- **Replaces ALL secrets** (`'SECRET_OR_PRIVATE_KEY...'` → unique random values)
- **Updates database names** (`nest-server-*` → `<project-name>-*`)
- Installs dependencies
- Optionally initializes git

**Post-creation verification**:
- Verify `src/config.env.ts` has no `SECRET_OR_PRIVATE_KEY` placeholders
- Verify mongoose.uri uses project name (e.g., `my-api-local` not `nest-server-local`)
- If using older CLI (<v0.0.126), run `lt server setConfigSecrets` manually

### Create SubObject
```bash
lt server object --name <Name> \
  --prop-name-0 <name> --prop-type-0 <type> [modifiers] \
  --prop-name-1 <name> --prop-type-1 <type> [modifiers]
```

### Create Module
```bash
lt server module --name <Name> --controller <Rest|GraphQL|Both> \
  --prop-name-0 <name> --prop-type-0 <type> [modifiers] \
  --prop-name-1 <name> --prop-type-1 <type> [modifiers]
```

### Add Properties
```bash
lt server addProp --type Module --element <Name> \
  --prop-name-0 <name> --prop-type-0 <type> [modifiers]
```

### Modifiers

| Modifier | Flag | Example |
|----------|------|---------|
| Optional | `--prop-nullable-X true` | `--prop-nullable-2 true` |
| Array | `--prop-array-X true` | `--prop-array-1 true` |
| Enum | `--prop-enum-X <EnumName>` | `--prop-enum-3 StatusEnum` |
| Schema | `--prop-schema-X <SchemaName>` | `--prop-schema-0 Address` |
| Reference | `--prop-reference-X <ModelName>` | `--prop-reference-1 User` |

## Description Format

**⚠️ CRITICAL:** Always extract descriptions from user comments (after `//`) and apply EVERYWHERE!

**Rule**: `"ENGLISH_DESCRIPTION (DEUTSCHE_BESCHREIBUNG)"`

### Processing

| Input Comment | Language | Output Description |
|---------------|----------|-------------------|
| `// Product name` | English | `'Product name'` |
| `// Produktname` | German | `'Product name (Produktname)'` |
| `// Street name` | English | `'Street name'` |
| `// Straße` | German | `'Street (Straße)'` |
| `// Postleizahl` (typo) | German | `'Postal code (Postleitzahl)'` (corrected) |
| (no comment) | - | Create meaningful English description |

**⚠️ Preserve Original Wording:**
- ✅ Fix typos: `Postleizahl` → `Postleitzahl`, `Starße` → `Straße`
- ❌ DON'T rephrase: `Straße` → `Straßenname` (NO!)
- ❌ DON'T expand: `Produkt` → `Produktbezeichnung` (NO!)
- **Reason:** User comments may be predefined terms referenced by external systems

### Apply To ALL Files

**For EVERY Module property** (3 files):
1. `<module>.model.ts` → Property `@UnifiedField({ description: '...' })`
2. `inputs/<module>-create.input.ts` → Property `@UnifiedField({ description: '...' })`
3. `inputs/<module>.input.ts` → Property `@UnifiedField({ description: '...' })`

**For EVERY SubObject property** (3 files):
1. `objects/<object>/<object>.object.ts` → Property `@UnifiedField({ description: '...' })`
2. `objects/<object>/<object>-create.input.ts` → Property `@UnifiedField({ description: '...' })`
3. `objects/<object>/<object>.input.ts` → Property `@UnifiedField({ description: '...' })`

**For class decorators**:
- `@ObjectType({ description: '...' })` on Models and Objects
- `@InputType({ description: '...' })` on all Input classes

### Common Mistakes

❌ **WRONG:** Descriptions only in Model, missing in Inputs
❌ **WRONG:** German-only descriptions without English translation
❌ **WRONG:** Inconsistent descriptions (different in Model vs Input)
❌ **WRONG:** Ignoring user-provided comments from specification
❌ **WRONG:** Changing wording: `Straße` → `Straßenname` (rephrased!)
❌ **WRONG:** Expanding terms: `Produkt` → `Produktbezeichnung` (added word!)

✅ **CORRECT:** Same description in ALL 3 files (Model, CreateInput, UpdateInput)
✅ **CORRECT:** Format `ENGLISH (DEUTSCH)` for German comments
✅ **CORRECT:** All user comments extracted and applied
✅ **CORRECT:** Fix typos only, preserve original wording: `Postleizahl` → `Postleitzahl`
✅ **CORRECT:** Keep exact terms: `Straße` → `Street (Straße)` (not "Street name"!)

## Inheritance Handling

### Model Extension

```typescript
// FROM (generated):
import { CoreModel } from '@lenne.tech/nest-server';
export class ChildModel extends CoreModel { ... }

// TO (manual edit):
import { ParentModel } from '../../common/objects/parent/parent.model';
export class ChildModel extends ParentModel { ... }
```

### Input Extension

```typescript
// child-create.input.ts
// MUST include:
// 1. ALL required fields from parent's CreateInput
// 2. ALL required fields from child model
// 3. Optional fields from both (optional in UpdateInput)
```

### Core Models (no changes needed)
- `CoreModel`
- `CorePersisted`
- Any @lenne.tech/nest-server base class

## Enum File Template

```typescript
// src/server/common/enums/<name>.enum.ts
export enum <Name>Enum {
  VALUE_ONE = 'VALUE_ONE',
  VALUE_TWO = 'VALUE_TWO',
  VALUE_THREE = 'VALUE_THREE',
}
```

### Naming
- **File**: `kebab-case.enum.ts` → `user-status.enum.ts`
- **Enum**: `PascalCaseEnum` → `UserStatusEnum`
- **Values**: `UPPER_SNAKE_CASE` → `ACTIVE`, `PENDING`

## API Test Template

```typescript
// test/<module>/<module>.controller.test.ts
import { testHelper } from '@lenne.tech/nest-server';

describe('<Module> Controller', () => {
  let testUser;
  let created<Model>;

  beforeAll(async () => {
    testUser = await testHelper.createTestUser({ roles: ['admin'] });
  });

  afterAll(async () => {
    if (created<Model>) await testHelper.delete('<modules>', created<Model>.id);
    await testHelper.deleteTestUser(testUser.id);
  });

  it('should create with required fields', async () => { /* ... */ });
  it('should fail without required fields', async () => { /* ... */ });
  it('should get all', async () => { /* ... */ });
  it('should get by id', async () => { /* ... */ });
  it('should update', async () => { /* ... */ });
  it('should delete', async () => { /* ... */ });
  it('should fail without auth', async () => { /* ... */ });
});
```

### Test Coverage
- ✅ Create (valid data)
- ✅ Create (missing required - fail)
- ✅ Find all
- ✅ Find by ID
- ✅ Update
- ✅ Delete
- ✅ Authorization (fail without auth)
- ✅ Required fields validation

## Common Patterns

### Pattern 1: Simple Module
```
Module: Product
Model: Product
- name: string
- price: number
```
→ `lt server module --name Product --controller Both --prop-name-0 name --prop-type-0 string --prop-name-1 price --prop-type-1 number`

### Pattern 2: Module with Reference
```
Module: Order
Model: Order
- customer: User
- total: number
```
→ `lt server module --name Order --controller Both --prop-name-0 customer --prop-type-0 ObjectId --prop-reference-0 User --prop-name-1 total --prop-type-1 number`

### Pattern 3: Module with Embedded Object
```
SubObject: Address
- street: string
- city: string

Module: Company
Model: Company
- name: string
- address: Address
```
→ Create Address first, then Company with `--prop-schema-X Address`

### Pattern 4: Module with Enum Array
```
Module: User
Model: User
- name: string
- roles: ENUM (ADMIN, USER, GUEST)[]
```
→ `--prop-name-1 roles --prop-enum-1 RoleEnum --prop-array-1 true`

### Pattern 5: Inheritance
```
Object: BaseProfile
Properties:
- name: string
- email: string

Module: UserProfile
Model: UserProfile
Extends: BaseProfile
- username: string
```
→ Create BaseProfile object, create UserProfile module, manually update to extend BaseProfile

### Pattern 6: Circular References
```
Module: Author
- books: Book[]

Module: Book
- author: Author
```
→ Create Author, create Book with author ref, use addProp to add books to Author

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Missing imports | Add manually: `import { Ref } from '@lenne.tech/nest-server'` |
| CreateInput validation fails | Add parent's required fields to child's CreateInput |
| Enum errors | Create enum file in `src/server/common/enums/` |
| Test fails (required fields) | Check CreateInput for all required fields |
| Circular dependency | Use `addProp` for second reference |
| Properties not alphabetical | Reorder manually in all files |
| TypeScript errors after inheritance | Check imports and extend statement |

## Verification Checklist

Final checks before completing:

```
☐ All SubObjects created
☐ All Objects created
☐ All Modules created
☐ Properties in alphabetical order
☐ DESCRIPTIONS - CRITICAL (check ALL):
  ☐ User comments extracted from specification
  ☐ German descriptions → ENGLISH (DEUTSCH) format
  ☐ English descriptions → kept as-is
  ☐ Module Models have descriptions
  ☐ Module CreateInputs have SAME descriptions
  ☐ Module UpdateInputs have SAME descriptions
  ☐ SubObjects have descriptions
  ☐ SubObject CreateInputs have SAME descriptions
  ☐ SubObject UpdateInputs have SAME descriptions
  ☐ @ObjectType/@InputType decorators have descriptions
  ☐ NO inconsistencies between files
☐ Inheritance correctly implemented
☐ CreateInputs have all required fields (parent + model)
☐ Enum files created in src/server/common/enums/
☐ API tests created for all modules
☐ Tests cover CRUD operations
☐ Tests verify authorization
☐ Tests verify required fields
☐ All tests pass
☐ No TypeScript errors
☐ Lint passes
```

## File Structure

```
src/server/
├── modules/
│   ├── <module-name>/
│   │   ├── <module-name>.model.ts
│   │   ├── <module-name>.service.ts
│   │   ├── <module-name>.controller.ts (if Rest/Both)
│   │   ├── <module-name>.resolver.ts (if GraphQL/Both)
│   │   ├── <module-name>.module.ts
│   │   ├── inputs/
│   │   │   ├── <module-name>.input.ts
│   │   │   └── <module-name>-create.input.ts
│   │   └── outputs/
│   │       └── find-and-count-<module-name>s-result.output.ts
│   └── ...
└── common/
    ├── objects/
    │   ├── <object-name>/
    │   │   ├── <object-name>.object.ts
    │   │   ├── <object-name>.input.ts
    │   │   └── <object-name>-create.input.ts
    │   └── ...
    └── enums/
        ├── <enum-name>.enum.ts
        └── ...

test/
├── <module-name>/
│   ├── <module-name>.controller.test.ts
│   └── <module-name>.resolver.test.ts
└── ...
```

## Best Practices Summary

1. ✅ **Plan before executing** - Analyze full specification first
2. ✅ **Create dependencies first** - SubObjects → Objects → Modules
3. ✅ **Follow naming conventions** - PascalCase for types, camelCase for properties
4. ✅ **Order matters** - Alphabetical properties, dependency-ordered creation
5. ✅ **Describe thoroughly** - "ENGLISH (DEUTSCH)" everywhere
6. ✅ **Test comprehensively** - All CRUD + auth + validation
7. ✅ **Clean up tests** - Delete test data in afterAll
8. ✅ **Commit incrementally** - After SubObjects, Modules, Tests
9. ✅ **Verify before finishing** - Run checklist, ensure tests pass
10. ✅ **Report observations** - Note data structure issues/improvements

## Quick Start

```bash
# 1. Receive specification
# 2. Parse and create todo list
# 3. Execute commands in order:

# SubObjects
lt server object --name Address --prop-name-0 street --prop-type-0 string ...

# Modules
lt server module --name User --controller Both --prop-name-0 email --prop-type-0 string ...

# Enums
# Create files in src/server/common/enums/

# Tests
# Create test files for each module

# 4. Verify and report
npm test
npm run lint
# Provide summary
```

---

**Remember**: This skill handles COMPLETE structure generation, not individual commands. Always process the full specification systematically and provide comprehensive summaries.