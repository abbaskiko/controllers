import { handleFetch } from './util';

function getPricingURL(currentCurrency: string, nativeCurrency: string) {
  return (
    `https://min-api.cryptocompare.com/data/price?fsym=` +
    `${nativeCurrency.toUpperCase()}&tsyms=${currentCurrency.toUpperCase()}`
  );
}

  /**
   * Fetches the exchange rate for a given currency
   *
   * @param currency - ISO 4217 currency code
   * @param nativeCurrency - Symbol for base asset
   * @returns Promise resolving to exchange rate for given currency
   */
export async function fetchExchangeRate(currency: string, nativeCurrency: string): Promise<number> {
  const json = await handleFetch(getPricingURL(currency, nativeCurrency));
  const conversionRate = Number(json[currency.toUpperCase()]);

  if (!Number.isFinite(conversionRate)) {
    throw new Error(`Invalid response for ${currency.toUpperCase()}: ${json[currency.toUpperCase()]}`);
  }

  return conversionRate;
}
