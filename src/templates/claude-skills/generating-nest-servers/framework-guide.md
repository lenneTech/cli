---
name: nest-server-generator-framework
version: 1.0.0
description: Complete guide to @lenne.tech/nest-server framework - CrudService base class, ServiceOptions handling, patterns for Service inheritance, and best practices for working with the framework
---

# 📚 Understanding the @lenne.tech/nest-server Framework

## Table of Contents
- [Core Service Base Class: CrudService](#core-service-base-class-crudservice)
- [CRITICAL: ServiceOptions When Calling Other Services](#-critical-serviceoptions-when-calling-other-services)
- [Framework Patterns](#framework-patterns)
- [Key Takeaways](#key-takeaways)

## Core Service Base Class: CrudService

**IMPORTANT**: Before working with Services, ALWAYS read this file to understand the base functionality:

```
node_modules/@lenne.tech/nest-server/src/core/common/services/crud.service.ts
```

**Why this is critical:**
- Almost ALL Services extend `CrudService<Model>`
- CrudService provides base CRUD operations (create, find, update, delete)
- Understanding CrudService prevents reinventing the wheel
- Shows patterns for handling permissions, filtering, and pagination

**When to read CrudService:**
1. ✅ Before creating a new Service
2. ✅ When implementing custom Service methods
3. ✅ When debugging Service behavior
4. ✅ When writing tests for Services
5. ✅ When questions arise about Service functionality

**What CrudService provides:**
- `create(input, options)` - Create new document
- `find(filterArgs)` - Find multiple documents
- `findOne(filterArgs)` - Find single document
- `findAndCount(filterArgs)` - Find with total count (pagination)
- `update(id, input, options)` - Update document
- `delete(id, options)` - Delete document
- Permission handling via `options.roles`
- Query filtering and population
- Pagination support

**Example Service that extends CrudService:**
```typescript
@Injectable()
export class ProductService extends CrudService<Product> {
  constructor(
    @InjectModel(Product.name) protected readonly productModel: Model<ProductDocument>,
    protected readonly configService: ConfigService,
  ) {
    super({ configService, mainDbModel: productModel, mainModelConstructor: Product });
  }

  // Custom methods can be added here
  // Base CRUD methods are inherited from CrudService
}
```

**Action Items:**
- [ ] Read CrudService before modifying any Service
- [ ] Check if CrudService already provides the needed functionality
- [ ] Only add custom methods if CrudService doesn't cover the use case
- [ ] Follow CrudService patterns for consistency

---

## 🚨 CRITICAL: ServiceOptions When Calling Other Services

**NEVER blindly pass all ServiceOptions when calling another Service!**

When a Service method calls another Service, you must carefully analyze which options to pass:

### ❌ WRONG - Blindly passing all options

```typescript
async createOrder(input: CreateOrderInput, serviceOptions: ServiceOptions) {
  // ❌ BAD: Passes ALL serviceOptions without checking
  const product = await this.productService.findOne({ id: input.productId }, serviceOptions);

  // ❌ BAD: inputType might be wrong for userService
  const user = await this.userService.findOne({ id: input.userId }, serviceOptions);
}
```

### ✅ CORRECT - Selectively passing required options

```typescript
async createOrder(input: CreateOrderInput, serviceOptions: ServiceOptions) {
  // ✅ GOOD: Only pass currentUser (needed for permissions)
  const product = await this.productService.findOne(
    { id: input.productId },
    { currentUser: serviceOptions.currentUser }
  );

  // ✅ GOOD: Only set inputType if different Input class is needed
  const user = await this.userService.findOne(
    { id: input.userId },
    {
      currentUser: serviceOptions.currentUser,
      inputType: UserInput // Only if specific Input class needed (e.g., UserInput, UserInputCreate)
    }
  );

  // ✅ ALSO GOOD: Don't pass inputType if not needed
  const category = await this.categoryService.findOne(
    { id: input.categoryId },
    { currentUser: serviceOptions.currentUser } // No inputType - use default
  );
}
```

### Why this is critical

- **inputType** specifies which Input class (DTO) to use for validation (e.g., `UserInput`, `UserInputCreate`)
- The inputType from outer service might be wrong for inner service call
- **roles** might need to be different for the called service
- **Other options** (limit, skip, etc.) might not apply to the inner call
- Blindly passing options can cause **incorrect permission checks** or **wrong validation**
- Can lead to **unexpected behavior** in nested service calls

### Analysis Checklist Before Passing ServiceOptions

1. **Analyze current serviceOptions:**
   ```typescript
   // What's in serviceOptions right now?
   // - currentUser? (usually needed)
   // - inputType? (which Input class: UserInput, UserInputCreate, etc.?)
   // - roles? (are these the right roles?)
   // - other options? (limit, skip, populate, etc.)
   ```

2. **Check target Service requirements:**
   - What does the target Service method need?
   - Read the target Service method signature
   - Check what permissions/validations it performs
   - Understand which Input class (inputType) is appropriate

3. **Pass only required options:**
   ```typescript
   // Build options object with only what's needed
   const targetOptions: ServiceOptions = {
     currentUser: serviceOptions.currentUser, // Usually needed
     // inputType: Only set if specific Input class is needed (e.g., UserInput, UserInputCreate)!
     // roles: Only if different roles are needed
     // Don't include: limit, skip, etc. unless specifically needed
   };
   ```

### Common Patterns

- **Reading data for validation**: Usually only need `currentUser` (no inputType needed)
- **Creating related entities**: May need different Input class as inputType (e.g., `UserInputCreate` instead of `UserInput`)
- **Admin operations**: May need to override `roles` or set specific Input class (only if necessary)
- **Nested CRUD operations**: Carefully consider each option - often only currentUser needed

### Action Items

- [ ] Before calling another Service, analyze current serviceOptions
- [ ] Determine which options the target Service actually needs
- [ ] Only pass required options (usually just currentUser)
- [ ] Only set inputType if a specific Input class (DTO) is needed (e.g., UserInput, UserInputCreate)
- [ ] NEVER blindly pass all serviceOptions

---

## Framework Patterns

### Service Inheritance Pattern

All Services follow this pattern:

```typescript
@Injectable()
export class YourService extends CrudService<YourModel> {
  constructor(
    @InjectModel(YourModel.name) protected readonly yourModel: Model<YourModelDocument>,
    protected readonly configService: ConfigService,
    // Inject other services if needed
    private readonly otherService: OtherService,
  ) {
    super({
      configService,
      mainDbModel: yourModel,
      mainModelConstructor: YourModel
    });
  }

  // Add custom methods here
  async customMethod(input: SomeInput, serviceOptions?: ServiceOptions) {
    // Your custom logic
    // Can call base methods: this.create(), this.find(), etc.
    // Can call other services with proper ServiceOptions handling
  }
}
```

### Controller/Resolver Pattern

Controllers and Resolvers use Services:

```typescript
@Controller('api/products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  @Roles(RoleEnum.S_USER)
  async getProducts(@CurrentUser() user: User) {
    return this.productService.find({ currentUser: user });
  }

  @Post()
  @Roles(RoleEnum.S_USER)
  async createProduct(
    @Body() input: ProductCreateInput,
    @CurrentUser() user: User
  ) {
    return this.productService.create(input, { currentUser: user });
  }
}
```

### Permission Handling Pattern

```typescript
// In Model
export class Product extends CoreModel {
  securityCheck(user: User, force?: boolean) {
    if (force || user?.hasRole(RoleEnum.ADMIN)) {
      return this; // Admin sees all
    }
    if (!equalIds(user, this.createdBy)) {
      return undefined; // Non-creator gets nothing
    }
    return this; // Creator sees own products
  }
}

// In Service
async customMethod(input: Input, serviceOptions?: ServiceOptions) {
  // CrudService automatically applies securityCheck
  const results = await this.find({ currentUser: serviceOptions.currentUser });
  // Only products passing securityCheck are returned
}
```

---

## Key Takeaways

1. **Always read CrudService first** - Understand what's already provided
2. **Never blindly pass ServiceOptions** - Analyze and pass only what's needed
3. **Follow framework patterns** - Inherit from CrudService, use proper decorators
4. **Understand permission flow** - securityCheck + serviceOptions.currentUser + @Roles
5. **inputType is the Input CLASS** - Not an enum, but the actual DTO class (e.g., UserInput, UserInputCreate)
