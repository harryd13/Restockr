export const branches = [
  { id: "BR", name: "Foffee Brahmpuri", code: "BRAHMPURI" },
  { id: "RS", name: "Foffee Ridhi-Sidhi", code: "RIDHI" },
  { id: "RP", name: "Foffee Rajapark", code: "RAJAPARK" }
];

export const users = [
  { id: "u1", name: "Brahmpuri Branch", email: "brahmpuri@foffee.in", password: "branch123", role: "BRANCH", branchId: "BR" },
  { id: "u2", name: "Ridhi-Sidhi Branch", email: "ridhi@foffee.in", password: "branch123", role: "BRANCH", branchId: "RS" },
  { id: "u3", name: "Rajapark Branch", email: "rajapark@foffee.in", password: "branch123", role: "BRANCH", branchId: "RP" },
  { id: "u4", name: "Ops Head", email: "ops@foffee.in", password: "ops123", role: "OPS", branchId: null },
  { id: "u5", name: "Admin", email: "admin@foffee.in", password: "admin123", role: "ADMIN", branchId: null }
];

export const categories = [
  { id: "c1", name: "Dairy" },
  { id: "c2", name: "Vegetables" },
  { id: "c3", name: "Bakery" },
  { id: "c4", name: "Coffee & Syrups" }
];

export const items = [
  { id: "i1", name: "Full Cream Milk 1L", categoryId: "c1", unit: "litre", defaultPrice: 55 },
  { id: "i2", name: "Toned Milk 1L", categoryId: "c1", unit: "litre", defaultPrice: 50 },
  { id: "i3", name: "Paneer 1kg", categoryId: "c1", unit: "kg", defaultPrice: 320 },
  { id: "i4", name: "Tomatoes 1kg", categoryId: "c2", unit: "kg", defaultPrice: 40 },
  { id: "i5", name: "Onions 1kg", categoryId: "c2", unit: "kg", defaultPrice: 30 },
  { id: "i6", name: "Burger Buns (10 pcs)", categoryId: "c3", unit: "pack", defaultPrice: 60 },
  { id: "i7", name: "Espresso Blend 1kg", categoryId: "c4", unit: "kg", defaultPrice: 900 },
  { id: "i8", name: "Caramel Syrup 1L", categoryId: "c4", unit: "litre", defaultPrice: 380 }
];

export const weeklyRequests = [];
export const weeklyRequestItems = [];
export const purchaseLogs = [];

