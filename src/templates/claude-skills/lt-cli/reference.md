# LT CLI Quick Reference

## Command Cheat Sheet

### Module Commands
```bash
# Interactive
lt server module
lt server m

# Non-interactive
lt server module --name <Name> --controller <Rest|GraphQL|Both> [props]
```

### Add Property Commands
```bash
# Interactive
lt server addProp
lt server ap

# Non-interactive
lt server addProp --type <Module|Object> --element <name> [props]
```

### Object Commands
```bash
# Interactive
lt server object
lt server o

# Non-interactive
lt server object --name <Name> [props] [--skipLint]
```

### Fullstack Commands
```bash
# Interactive
lt fullstack init
lt full init

# Non-interactive
lt fullstack init --name <Name> --frontend <angular|nuxt> --git <true|false> [--git-link <url>]
```

---

## Property Flag Reference

| Flag | Description | Example | Required |
|------|-------------|---------|----------|
| `--prop-name-X` | Property name | `--prop-name-0 title` | Yes |
| `--prop-type-X` | Property type | `--prop-type-0 string` | No (default: string) |
| `--prop-nullable-X` | Is optional | `--prop-nullable-0 true` | No (default: false) |
| `--prop-array-X` | Is array | `--prop-array-0 true` | No (default: false) |
| `--prop-enum-X` | Enum reference | `--prop-enum-0 StatusEnum` | No |
| `--prop-schema-X` | Object reference | `--prop-schema-0 Address` | No |
| `--prop-reference-X` | ObjectId reference | `--prop-reference-0 User` | Yes (with ObjectId) |

---

## Type Mapping

### Primitive Types
| Type | TypeScript | MongoDB | Use Case |
|------|-----------|---------|----------|
| `string` | `string` | String | Text, names, descriptions |
| `number` | `number` | Number | Integers, floats, counts |
| `boolean` | `boolean` | Boolean | Flags, toggles |
| `Date` | `Date` | Date | Timestamps, dates |
| `bigint` | `bigint` | Long | Large integers |

### Special Types
| Type | Model Type | Input Type | Notes |
|------|-----------|-----------|--------|
| `ObjectId` | `Reference` | `ReferenceInput` | Requires `--prop-reference-X` |
| `Json` | `JSON` | `JSON` | Flexible metadata |
| Custom Object | `<Name>` | `<Name>Input` | Requires `--prop-schema-X` |
| Custom Enum | `<Name>Enum` | `<Name>Enum` | Requires `--prop-enum-X` |

---

## Decorator Reference

### Model Decorators
```typescript
@Prop()                    // MongoDB property
@UnifiedField()            // GraphQL + REST
@Restricted(RoleEnum.XXX)  // Access control
```

### Input Decorators
```typescript
@UnifiedField()            // GraphQL + REST
@IsOptional()              // Validation
@IsEmail()                 // Email validation
@IsString()                // String validation
```

---

## File Structure Reference

### Module Structure
```
src/server/modules/<module-name>/
├── <module-name>.model.ts              # MongoDB schema
├── <module-name>.service.ts            # Business logic
├── <module-name>.controller.ts         # REST endpoints
├── <module-name>.resolver.ts           # GraphQL resolver
├── <module-name>.module.ts             # NestJS module
├── inputs/
│   ├── <module-name>.input.ts          # Update DTO
│   └── <module-name>-create.input.ts   # Create DTO
└── outputs/
    └── find-and-count-<module-name>s-result.output.ts
```

### Object Structure
```
src/server/common/objects/<object-name>/
├── <object-name>.object.ts             # Object class
├── <object-name>.input.ts              # Update DTO
└── <object-name>-create.input.ts       # Create DTO
```

---

## Common Command Patterns

### Simple Module (No Properties)
```bash
lt server module --name Category --controller Rest
```

### Module with Basic Properties
```bash
lt server module --name Product --controller Both \
  --prop-name-0 name --prop-type-0 string \
  --prop-name-1 price --prop-type-1 number \
  --prop-name-2 active --prop-type-2 boolean
```

### Module with Nullable Property
```bash
lt server module --name Post --controller GraphQL \
  --prop-name-0 title --prop-type-0 string \
  --prop-name-1 subtitle --prop-type-1 string --prop-nullable-1 true
```

### Module with Array Property
```bash
lt server module --name Article --controller Both \
  --prop-name-0 title --prop-type-0 string \
  --prop-name-1 tags --prop-type-1 string --prop-array-1 true
```

### Module with ObjectId Reference
```bash
lt server module --name Comment --controller Rest \
  --prop-name-0 content --prop-type-0 string \
  --prop-name-1 author --prop-type-1 ObjectId --prop-reference-1 User
```

### Module with Schema/Object
```bash
lt server module --name Company --controller Both \
  --prop-name-0 name --prop-type-0 string \
  --prop-name-1 address --prop-schema-1 Address
```

### Module with Enum
```bash
lt server module --name Order --controller Both \
  --prop-name-0 orderNumber --prop-type-0 string \
  --prop-name-1 status --prop-enum-1 OrderStatusEnum
```

### Module with JSON Metadata
```bash
lt server module --name Product --controller Both \
  --prop-name-0 name --prop-type-0 string \
  --prop-name-1 metadata --prop-type-1 Json --prop-nullable-1 true
```

### Complex Module (Multiple Property Types)
```bash
lt server module --name Event --controller Both \
  --prop-name-0 title --prop-type-0 string \
  --prop-name-1 description --prop-type-1 string --prop-nullable-1 true \
  --prop-name-2 organizer --prop-type-2 ObjectId --prop-reference-2 User \
  --prop-name-3 attendees --prop-type-3 ObjectId --prop-reference-3 User --prop-array-3 true \
  --prop-name-4 startDate --prop-type-4 Date \
  --prop-name-5 endDate --prop-type-5 Date --prop-nullable-5 true \
  --prop-name-6 location --prop-schema-6 Location \
  --prop-name-7 status --prop-enum-7 EventStatusEnum \
  --prop-name-8 tags --prop-type-8 string --prop-array-8 true \
  --prop-name-9 metadata --prop-type-9 Json --prop-nullable-9 true
```

---

## Troubleshooting Guide

### Error: Cannot read properties of undefined (reading 'getChildIndex')
**Cause**: Input files have no existing properties (fixed in latest version)
**Solution**: Update to latest CLI version or ensure files have at least one property

### Error: Module directory already exists
**Cause**: Trying to create a module that already exists
**Solution**: Use `lt server addProp` instead

### Error: No src directory found
**Cause**: Running command outside of project directory
**Solution**: Navigate to project directory (anywhere inside works)

### TypeScript Errors: Cannot find name 'Reference'
**Cause**: Missing imports for referenced modules
**Solution**: Manually add imports:
```typescript
import { Reference } from '@lenne.tech/nest-server';
import { User } from '../../user/user.model';
```

### Property Index Mismatch
**Cause**: Using different indices for same property
**Wrong**:
```bash
--prop-name-1 company --prop-type-0 string
```
**Correct**:
```bash
--prop-name-1 company --prop-type-1 string
```

### Boolean Value Errors
**Wrong**: `--prop-nullable-0 True` or `--prop-nullable-0 TRUE`
**Correct**: `--prop-nullable-0 true` (lowercase)

---

## Best Practices Checklist

- [ ] Plan data model before generating
- [ ] Create objects for reusable structures first
- [ ] Use meaningful, descriptive names
- [ ] Create referenced modules before referencing them
- [ ] Start with one API type (Rest or GraphQL)
- [ ] Mark only truly optional fields as nullable
- [ ] Use arrays for collections
- [ ] Use JSON for flexible/extensible data
- [ ] Create enums before using them
- [ ] Run lint after generation
- [ ] Test incrementally
- [ ] Commit after successful generation
- [ ] Review generated code before modifying
- [ ] Add custom business logic in services
- [ ] Document complex relationships

---

## Naming Conventions

### Modules & Objects
- **Format**: PascalCase
- **Examples**: `User`, `BlogPost`, `OrderItem`, `ProductCategory`

### Properties
- **Format**: camelCase
- **Examples**: `firstName`, `emailAddress`, `isActive`, `createdAt`

### Enum Names
- **Format**: PascalCase + "Enum" suffix
- **Examples**: `UserStatusEnum`, `OrderStatusEnum`, `PriorityEnum`

### File Names
- **Format**: kebab-case
- **Examples**: `user.model.ts`, `blog-post.service.ts`, `order-item.input.ts`

---

## Controller Type Decision Guide

### Choose REST when:
- Building traditional CRUD APIs
- Simple data fetching needs
- RESTful conventions are preferred
- Mobile/web clients expect REST

### Choose GraphQL when:
- Complex data relationships
- Frontend needs flexible queries
- Reducing over-fetching/under-fetching
- Real-time subscriptions needed

### Choose Both when:
- Supporting multiple client types
- Gradual migration from REST to GraphQL
- Maximum flexibility required
- Unsure about future requirements

---

## Related Technologies

### Dependencies
- **NestJS**: Node.js framework
- **Mongoose**: MongoDB ODM
- **GraphQL**: Query language
- **TypeScript**: Type-safe JavaScript
- **ts-morph**: TypeScript AST manipulation

### Generated Decorators
- `@Prop()`: Mongoose schema definition
- `@UnifiedField()`: GraphQL + REST exposure
- `@Restricted()`: Access control
- `@IsOptional()`: Validation
- `@Field()`: GraphQL field

---

## Quick Tips

1. **Use indices consistently**: All flags for one property use same index
2. **ObjectId always needs reference**: `--prop-reference-X` is required
3. **Quote special characters**: Wrap values with spaces in quotes
4. **Lowercase booleans**: Use `true`/`false`, not `True`/`FALSE`
5. **Run from anywhere**: CLI finds `src/` automatically
6. **Check before creating**: Use `addProp` for existing modules
7. **Plan relationships**: Create referenced modules first
8. **Use objects for reuse**: Don't duplicate structures
9. **Start simple**: Add complexity incrementally
10. **Commit often**: Save after each successful generation