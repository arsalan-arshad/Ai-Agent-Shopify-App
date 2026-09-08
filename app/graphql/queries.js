// Admin GraphQL queries used by the forecasting engine.
// Run via: const response = await admin.graphql(QUERY, { variables });

export const RECENT_ORDERS_QUERY = `#graphql
  query RecentOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
      edges {
        cursor
        node {
          id
          createdAt
          lineItems(first: 50) {
            edges {
              node {
                quantity
                sku
                title
                variant {
                  id
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

export const INVENTORY_LEVELS_QUERY = `#graphql
  query InventoryLevels($first: Int!) {
    inventoryItems(first: $first) {
      edges {
        node {
          id
          sku
          variant {
            displayName
          }
          inventoryLevels(first: 5) {
            edges {
              node {
                location {
                  name
                }
                quantities(names: ["available"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
      }
    }
  }
`;
