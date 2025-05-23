import { ApolloProvider, ApolloClient, InMemoryCache } from "@apollo/client";
import App from "next/app";
import { AppProvider } from "@shopify/polaris";
import { Provider, useAppBridge } from "@shopify/app-bridge-react";
import { authenticatedFetch, getSessionToken } from "@shopify/app-bridge-utils";
import { Redirect } from "@shopify/app-bridge/actions";
import translations from "@shopify/polaris/locales/en.json";
import Head from "next/head";

function userLoggedInFetch(app) {
  const fetchFunction = authenticatedFetch(app);

  return async (uri, options) => {
    const response = await fetchFunction(uri, options);

    if (
      response.headers.get("X-Shopify-API-Request-Failure-Reauthorize") === "1"
    ) {
      const authUrlHeader = response.headers.get(
        "X-Shopify-API-Request-Failure-Reauthorize-Url"
      );

      const redirect = Redirect.create(app);
      redirect.dispatch(Redirect.Action.APP, authUrlHeader || `/auth`);
      return null;
    }

    return response;
  };
}

function MyProvider(props) {
  const app = useAppBridge();

  const client = new ApolloClient({
    uri: "/graphql", // or your GraphQL endpoint
    cache: new InMemoryCache(),
    fetch: userLoggedInFetch(app),
    fetchOptions: {
      credentials: "include",
    },
  });

  const Component = props.Component;

  return (
    <ApolloProvider client={client}>
      <Component {...props} />
    </ApolloProvider>
  );
}

class MyApp extends App {
  render() {
    const { Component, pageProps, host } = this.props;
    return (
      <>
        <Head>
          <link
            rel="stylesheet"
            href="https://unpkg.com/@shopify/polaris@8.2.2/build/esm/styles.css"
          />
        </Head>
        <AppProvider i18n={translations}>
          <Provider
            config={{
              apiKey: API_KEY,
              host: host,
              forceRedirect: true,
            }}
          >
            <MyProvider Component={Component} {...pageProps} />
          </Provider>
        </AppProvider>
      </>
    );
  }
}

MyApp.getInitialProps = async ({ ctx }) => {
  return {
    host: ctx.query.host,
  };
};

export default MyApp;
