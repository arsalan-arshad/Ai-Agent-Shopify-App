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

// Paginated, multi-location inventory query. inventoryLevels is fetched
// for up to 10 locations per item and summed by buildForecastSnapshot
// (forecast-snapshot.server.js) — most merchants have 1-3 locations, so
// this comfortably covers them without a second nested pagination layer.
export const INVENTORY_LEVELS_QUERY = `#graphql
  query InventoryLevels($first: Int!, $after: String) {
    inventoryItems(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          sku
          variant {
            displayName
          }
          inventoryLevels(first: 10) {
            edges {
              node {
                location {
                  id
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
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;
