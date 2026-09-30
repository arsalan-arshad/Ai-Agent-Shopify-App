import { useState } from "react";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Button,
  BlockStack,
} from "@shopify/polaris";
import { LoginErrorType } from "@shopify/shopify-app-remix/server";
import { login } from "../lib/shopify.server.js";

export const loginErrorMessage = (loginErrors) => {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Please enter your shop domain to log in" };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Please enter a valid shop domain to log in" };
  }
  return loginErrors || {};
};

export const loader = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));
  return { errors };
};

export const action = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));
  return { errors };
};

export default function Auth() {
  const [shop, setShop] = useState("");
  const fetcher = useFetcher();
  const loaderData = useLoaderData();
  const errors = fetcher.data?.errors || loaderData?.errors;

  return (
    <Page>
      <Card>
        <BlockStack gap="400">
          <p>Log in to install AI Forecast Agent</p>
          <fetcher.Form method="post">
            <FormLayout>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="e.g. my-shop-name.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                error={errors?.shop}
              />
              <Button submit>Log in</Button>
            </FormLayout>
          </fetcher.Form>
        </BlockStack>
      </Card>
    </Page>
  );
}
