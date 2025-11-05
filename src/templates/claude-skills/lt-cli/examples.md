# LT CLI Examples

## Real-World Use Cases

### 1. Blog System

#### Step 1: Create User Module
```bash
lt server module --name User --controller Both \
  --prop-name-0 email --prop-type-0 string \
  --prop-name-1 username --prop-type-1 string \
  --prop-name-2 firstName --prop-type-2 string \
  --prop-name-3 lastName --prop-type-3 string \
  --prop-name-4 bio --prop-type-4 string --prop-nullable-4 true
```

#### Step 2: Create Category Module
```bash
lt server module --name Category --controller Rest \
  --prop-name-0 name --prop-type-0 string \
  --prop-name-1 slug --prop-type-1 string \
  --prop-name-2 description --prop-type-2 string --prop-nullable-2 true
```

#### Step 3: Create Post Module with References
```bash
lt server module --name Post --controller Both \
  --prop-name-0 title --prop-type-0 string \
  --prop-name-1 slug --prop-type-1 string \
  --prop-name-2 content --prop-type-2 string \
  --prop-name-3 excerpt --prop-type-3 string --prop-nullable-3 true \
  --prop-name-4 author --prop-type-4 ObjectId --prop-reference-4 User \
  --prop-name-5 category --prop-type-5 ObjectId --prop-reference-5 Category \
  --prop-name-6 tags --prop-type-6 string --prop-array-6 true \
  --prop-name-7 published --prop-type-7 boolean \
  --prop-name-8 publishedAt --prop-type-8 Date --prop-nullable-8 true
```

#### Step 4: Create Comment Module
```bash
lt server module --name Comment --controller GraphQL \
  --prop-name-0 content --prop-type-0 string \
  --prop-name-1 author --prop-type-1 ObjectId --prop-reference-1 User \
  --prop-name-2 post --prop-type-2 ObjectId --prop-reference-2 Post \
  --prop-name-3 approved --prop-type-3 boolean
```

---

### 2. E-Commerce Platform

#### Step 1: Create Address Object
```bash
lt server object --name Address \
  --prop-name-0 street --prop-type-0 string \
  --prop-name-1 city --prop-type-1 string \
  --prop-name-2 state --prop-type-2 string \
  --prop-name-3 zipCode --prop-type-3 string \
  --prop-name-4 country --prop-type-4 string
```

#### Step 2: Create Customer Module
```bash
lt server module --name Customer --controller Both \
  --prop-name-0 email --prop-type-0 string \
  --prop-name-1 firstName --prop-type-1 string \
  --prop-name-2 lastName --prop-type-2 string \
  --prop-name-3 phone --prop-type-3 string --prop-nullable-3 true \
  --prop-name-4 shippingAddress --prop-schema-4 Address \
  --prop-name-5 billingAddress --prop-schema-5 Address
```

#### Step 3: Create Product Module
```bash
lt server module --name Product --controller Both \
  --prop-name-0 name --prop-type-0 string \
  --prop-name-1 sku --prop-type-1 string \
  --prop-name-2 description --prop-type-2 string \
  --prop-name-3 price --prop-type-3 number \
  --prop-name-4 compareAtPrice --prop-type-4 number --prop-nullable-4 true \
  --prop-name-5 stock --prop-type-5 number \
  --prop-name-6 images --prop-type-6 string --prop-array-6 true \
  --prop-name-7 tags --prop-type-7 string --prop-array-7 true \
  --prop-name-8 active --prop-type-8 boolean
```

#### Step 4: Create Order Module
```bash
lt server module --name Order --controller Both \
  --prop-name-0 orderNumber --prop-type-0 string \
  --prop-name-1 customer --prop-type-1 ObjectId --prop-reference-1 Customer \
  --prop-name-2 items --prop-type-2 Json \
  --prop-name-3 subtotal --prop-type-3 number \
  --prop-name-4 tax --prop-type-4 number \
  --prop-name-5 total --prop-type-5 number \
  --prop-name-6 status --prop-enum-6 OrderStatusEnum \
  --prop-name-7 shippingAddress --prop-schema-7 Address
```

---

### 3. Project Management System

#### Step 1: Create Team Module
```bash
lt server module --name Team --controller Rest \
  --prop-name-0 name --prop-type-0 string \
  --prop-name-1 description --prop-type-1 string --prop-nullable-1 true \
  --prop-name-2 members --prop-type-2 ObjectId --prop-reference-2 User --prop-array-2 true
```

#### Step 2: Create Project Module
```bash
lt server module --name Project --controller Both \
  --prop-name-0 name --prop-type-0 string \
  --prop-name-1 description --prop-type-1 string \
  --prop-name-2 team --prop-type-2 ObjectId --prop-reference-2 Team \
  --prop-name-3 owner --prop-type-3 ObjectId --prop-reference-3 User \
  --prop-name-4 startDate --prop-type-4 Date \
  --prop-name-5 endDate --prop-type-5 Date --prop-nullable-5 true \
  --prop-name-6 status --prop-enum-6 ProjectStatusEnum
```

#### Step 3: Create Task Module
```bash
lt server module --name Task --controller Both \
  --prop-name-0 title --prop-type-0 string \
  --prop-name-1 description --prop-type-1 string --prop-nullable-1 true \
  --prop-name-2 project --prop-type-2 ObjectId --prop-reference-2 Project \
  --prop-name-3 assignee --prop-type-3 ObjectId --prop-reference-3 User --prop-nullable-3 true \
  --prop-name-4 priority --prop-enum-4 PriorityEnum \
  --prop-name-5 status --prop-enum-5 TaskStatusEnum \
  --prop-name-6 dueDate --prop-type-6 Date --prop-nullable-6 true \
  --prop-name-7 estimatedHours --prop-type-7 number --prop-nullable-7 true
```

---

### 4. Social Media Platform

#### Step 1: Create Profile Object
```bash
lt server object --name Profile \
  --prop-name-0 bio --prop-type-0 string --prop-nullable-0 true \
  --prop-name-1 avatar --prop-type-1 string --prop-nullable-1 true \
  --prop-name-2 coverImage --prop-type-2 string --prop-nullable-2 true \
  --prop-name-3 website --prop-type-3 string --prop-nullable-3 true \
  --prop-name-4 location --prop-type-4 string --prop-nullable-4 true
```

#### Step 2: Create User with Profile
```bash
lt server module --name User --controller Both \
  --prop-name-0 username --prop-type-0 string \
  --prop-name-1 email --prop-type-1 string \
  --prop-name-2 displayName --prop-type-2 string \
  --prop-name-3 profile --prop-schema-3 Profile \
  --prop-name-4 verified --prop-type-4 boolean
```

#### Step 3: Create Post Module
```bash
lt server module --name Post --controller Both \
  --prop-name-0 content --prop-type-0 string \
  --prop-name-1 author --prop-type-1 ObjectId --prop-reference-1 User \
  --prop-name-2 images --prop-type-2 string --prop-array-2 true \
  --prop-name-3 likes --prop-type-3 ObjectId --prop-reference-3 User --prop-array-3 true \
  --prop-name-4 hashtags --prop-type-4 string --prop-array-4 true \
  --prop-name-5 visibility --prop-enum-5 VisibilityEnum
```

#### Step 4: Add Features to User
```bash
lt server addProp --type Module --element User \
  --prop-name-0 followers --prop-type-0 ObjectId --prop-reference-0 User --prop-array-0 true \
  --prop-name-1 following --prop-type-1 ObjectId --prop-reference-1 User --prop-array-1 true
```

---

### 5. Learning Management System

#### Step 1: Create Course Module
```bash
lt server module --name Course --controller Both \
  --prop-name-0 title --prop-type-0 string \
  --prop-name-1 description --prop-type-1 string \
  --prop-name-2 instructor --prop-type-2 ObjectId --prop-reference-2 User \
  --prop-name-3 thumbnail --prop-type-3 string --prop-nullable-3 true \
  --prop-name-4 price --prop-type-4 number \
  --prop-name-5 duration --prop-type-5 number \
  --prop-name-6 level --prop-enum-6 CourseLevelEnum \
  --prop-name-7 tags --prop-type-7 string --prop-array-7 true \
  --prop-name-8 published --prop-type-8 boolean
```

#### Step 2: Create Lesson Module
```bash
lt server module --name Lesson --controller Both \
  --prop-name-0 title --prop-type-0 string \
  --prop-name-1 content --prop-type-1 string \
  --prop-name-2 course --prop-type-2 ObjectId --prop-reference-2 Course \
  --prop-name-3 order --prop-type-3 number \
  --prop-name-4 duration --prop-type-4 number \
  --prop-name-5 videoUrl --prop-type-5 string --prop-nullable-5 true \
  --prop-name-6 resources --prop-type-6 Json --prop-nullable-6 true
```

#### Step 3: Create Enrollment Module
```bash
lt server module --name Enrollment --controller Rest \
  --prop-name-0 student --prop-type-0 ObjectId --prop-reference-0 User \
  --prop-name-1 course --prop-type-1 ObjectId --prop-reference-1 Course \
  --prop-name-2 progress --prop-type-2 number \
  --prop-name-3 completedLessons --prop-type-3 ObjectId --prop-reference-3 Lesson --prop-array-3 true \
  --prop-name-4 enrolledAt --prop-type-4 Date \
  --prop-name-5 completedAt --prop-type-5 Date --prop-nullable-5 true
```

---

## Adding Properties to Existing Modules

### Add metadata to Product
```bash
lt server addProp --type Module --element Product \
  --prop-name-0 seo --prop-type-0 Json --prop-nullable-0 true \
  --prop-name-1 dimensions --prop-type-1 Json --prop-nullable-1 true
```

### Add timestamps to custom module
```bash
lt server addProp --type Module --element CustomModule \
  --prop-name-0 lastModifiedBy --prop-type-0 ObjectId --prop-reference-0 User \
  --prop-name-1 archivedAt --prop-type-1 Date --prop-nullable-1 true
```

### Add social features
```bash
lt server addProp --type Module --element Post \
  --prop-name-0 comments --prop-type-0 ObjectId --prop-reference-0 Comment --prop-array-0 true \
  --prop-name-1 shares --prop-type-1 number \
  --prop-name-2 views --prop-type-2 number
```

---

## Common Object Patterns

### Contact Information
```bash
lt server object --name ContactInfo \
  --prop-name-0 email --prop-type-0 string \
  --prop-name-1 phone --prop-type-1 string --prop-nullable-1 true \
  --prop-name-2 mobile --prop-type-2 string --prop-nullable-2 true \
  --prop-name-3 fax --prop-type-3 string --prop-nullable-3 true
```

### Price Range
```bash
lt server object --name PriceRange \
  --prop-name-0 min --prop-type-0 number \
  --prop-name-1 max --prop-type-1 number \
  --prop-name-2 currency --prop-type-2 string
```

### Geo Location
```bash
lt server object --name GeoLocation \
  --prop-name-0 latitude --prop-type-0 number \
  --prop-name-1 longitude --prop-type-1 number \
  --prop-name-2 address --prop-type-2 string --prop-nullable-2 true
```

### Media File
```bash
lt server object --name MediaFile \
  --prop-name-0 url --prop-type-0 string \
  --prop-name-1 filename --prop-type-1 string \
  --prop-name-2 mimeType --prop-type-2 string \
  --prop-name-3 size --prop-type-3 number
```

---

## Fullstack Project Initialization

### Angular Project
```bash
lt fullstack init \
  --name MyAngularApp \
  --frontend angular \
  --git true \
  --git-link https://github.com/myorg/my-angular-app.git
```

### Nuxt Project
```bash
lt fullstack init \
  --name MyNuxtApp \
  --frontend nuxt \
  --git true \
  --git-link https://github.com/myorg/my-nuxt-app.git
```

### Local Development (No Git)
```bash
lt fullstack init \
  --name LocalDevProject \
  --frontend angular \
  --git false
```