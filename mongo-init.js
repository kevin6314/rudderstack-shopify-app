db = db.getSiblingDB("shopify_new_db");
db.createUser({
  user: "rudder",
  pwd: "password",
  roles: [{ role: "readWrite", db: "shopify_new_db" }],
});
