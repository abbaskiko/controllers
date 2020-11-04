import { handleFetch, timeoutFetch, constructTxParams, BNToHex } from '../util';

export enum SwapsError {
  QUOTES_EXPIRED_ERROR = 'quotes-expired',
  SWAP_FAILED_ERROR = 'swap-failed-error',
  ERROR_FETCHING_QUOTES = 'error-fetching-quotes',
  QUOTES_NOT_AVAILABLE_ERROR = 'quotes-not-avilable',
  OFFLINE_FOR_MAINTENANCE = 'offline-for-maintenance',
  SWAPS_FETCH_ORDER_CONFLICT = 'swaps-fetch-order-conflict',
}

export enum APIType {
  TRADES = 'TRADES',
  TOKENS = 'TOKENS',
  TOP_ASSETS = 'TOP_ASSETS',
  FEATURE_FLAG = 'FEATURE_FLAG',
  AGGREGATOR_METADATA = 'AGGREGATOR_METADATA',
}

interface APITradeRequest {
  sourceToken: string;
  destinationToken: string;
  sourceAmount: string;
  slippage: number;
  excludeFees?: boolean;
  txOriginAddress?: string;
  timeout: number;
  walletAddress: string;
  exchangeList?: null | string[];
}

interface APIAsset {
  address: string;
  symbol: string;
  name?: string;
}

interface APIToken extends APIAsset {
  decimals: number;
  occurances?: number;
  iconUrl?: string;
}

interface APITrade {
  trade: null | {
    data: string;
    to: string;
    from: string;
    value: string;
    gas: number;
  };

  approvalNeeded: null | {
    data: string;
    to: string;
    from: string;
  };
  sourceAmount: string;
  destinationAmount: string;
  error: null | Error;
  sourceToken: string;
  destinationToken: string;
  maxGas: number;
  averageGas: number;
  estimatedRefund: number;
  fetchTime: number;
  aggregator: string;
  aggType: string;
  fee: number;
  gasMultiplier?: number;
}
interface APIAggregatorMetadataResponse {
  [key: string]: APIAggregatorMetadata;
}
interface APIAggregatorMetadata {
  color: string;
  title: string;
  icon: string;
}

// Constants

export const ETH_SWAPS_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

export const ETH_SWAPS_TOKEN_OBJECT: APIToken = {
  symbol: 'ETH',
  name: 'Ether',
  address: ETH_SWAPS_TOKEN_ADDRESS,
  decimals: 18,
  iconUrl: 'images/black-eth-logo.svg',
};

export const DEFAULT_ERC20_APPROVE_GAS = '0x1d4c0';

export const SWAPS_CONTRACT_ADDRESS = '0x881d40237659c251811cec9c364ef91dc08d300c';

// Functions

export const getBaseApiURL = function (type: APIType): string {
  switch (type) {
    case APIType.TRADES:
      return 'https://api.metaswap.codefi.network/trades';
    case APIType.TOKENS:
      return 'https://api.metaswap.codefi.network/tokens';
    case APIType.TOP_ASSETS:
      return 'https://api.metaswap.codefi.network/topAssets';
    case APIType.FEATURE_FLAG:
      return 'https://api.metaswap.codefi.network/featureFlag';
    case APIType.AGGREGATOR_METADATA:
      return 'https://api.metaswap.codefi.network/aggregatorMetadata';
    default:
      throw new Error('getBaseApiURL requires an api call type');
  }
};

export async function fetchTradesInfo({
  slippage,
  sourceToken,
  sourceAmount,
  destinationToken,
  fromAddress,
  exchangeList,
}: {
  slippage: number;
  sourceToken: string;
  sourceAmount: string;
  destinationToken: string;
  fromAddress: string;
  exchangeList?: string[];
}): Promise<Record<string, APITrade>> {
  const urlParams: APITradeRequest = {
    destinationToken,
    sourceToken,
    sourceAmount,
    slippage,
    timeout: 10000,
    walletAddress: fromAddress,
  };

  if (exchangeList) {
    urlParams.exchangeList = exchangeList;
  }

  const tradeURL = `${getBaseApiURL(APIType.TRADES)}?${new URLSearchParams(urlParams as Record<any, any>).toString()}`;
  const tradesResponse = ((await (
    await timeoutFetch(tradeURL, { method: 'GET' }, 15000)
  ).json()) as unknown) as APITrade[];

  const newQuotes = tradesResponse.reduce((aggIdTradeMap: Record<string, APITrade>, quote: APITrade) => {
    if (quote.trade && !quote.error) {
      const constructedTrade = constructTxParams({
        to: quote.trade.to,
        from: quote.trade.from,
        data: quote.trade.data,
        amount: BNToHex(quote.trade.value),
        gas: BNToHex(quote.maxGas),
      });

      let { approvalNeeded } = quote;

      if (approvalNeeded) {
        approvalNeeded = constructTxParams({
          ...approvalNeeded,
        });
      }

      return {
        ...aggIdTradeMap,
        [quote.aggregator]: {
          ...quote,
          slippage,
          trade: constructedTrade,
          approvalNeeded,
        },
      };
    }

    return aggIdTradeMap;
  }, {});

  return newQuotes;
}

export async function fetchTokens(): Promise<APIToken[]> {
  const tokenUrl = getBaseApiURL(APIType.TOKENS);
  const tokens: APIToken[] = await handleFetch(tokenUrl, { method: 'GET' });
  const filteredTokens = tokens.filter((token) => {
    return token.address !== ETH_SWAPS_TOKEN_ADDRESS;
  });
  tokens.push(ETH_SWAPS_TOKEN_OBJECT);
  return filteredTokens;
}

export async function fetchAggregatorMetadata() {
  const aggregatorMetadataUrl = getBaseApiURL(APIType.AGGREGATOR_METADATA);
  const aggregators: APIAggregatorMetadataResponse = await handleFetch(aggregatorMetadataUrl, { method: 'GET' });
  return aggregators;
}

export async function fetchTopAssets(): Promise<APIAsset[]> {
  const topAssetsUrl = getBaseApiURL(APIType.TOP_ASSETS);
  const response: APIAsset[] = await handleFetch(topAssetsUrl, { method: 'GET' });
  return response;
}

export async function fetchSwapsFeatureLiveness(): Promise<boolean> {
  try {
    const status = await handleFetch(getBaseApiURL(APIType.FEATURE_FLAG), { method: 'GET' });
    return status?.active;
  } catch (err) {
    return false;
  }
}

export async function fetchTokenPrice(address: string): Promise<string> {
  const query = `contract_addresses=${address}&vs_currencies=eth`;
  const prices = await handleFetch(`https://api.coingecko.com/api/v3/simple/token_price/ethereum?${query}`, {
    method: 'GET',
  });

  return prices && prices[address]?.eth;
}

// export function getRenderableNetworkFeesForQuote(
//   tradeGas,
//   approveGas,
//   gasPrice,
//   currentCurrency,
//   conversionRate,
//   tradeValue,
//   sourceSymbol,
//   sourceAmount,
// ) {}

// export function quotesToRenderableData(
//   quotes,
//   gasPrice,
//   conversionRate,
//   currentCurrency,
//   approveGas,
//   tokenConversionRates,
// ) {}

// export function getSwapsTokensReceivedFromTxMeta(
//   tokenSymbol,
//   txMeta,
//   tokenAddress,
//   accountAddress,
//   tokenDecimals,
//   approvalTxMeta,
// ) {}

// export function formatSwapsValueForDisplay(destinationAmount) {}

// function calculateGasEstimateWithRefund(
//   maxGas = MAX_GAS_LIMIT,
//   estimatedRefund = 0,
//   estimatedGas = 0,
// ) {
//   const maxGasMinusRefund = new BigNumber(maxGas, 10).minus(estimatedRefund, 10)

//   const gasEstimateWithRefund = maxGasMinusRefund.lt(estimatedGas, 16)
//     ? maxGasMinusRefund.toString(16)
//     : estimatedGas

//   return gasEstimateWithRefund
// }

// /**
//  * Calculates the median of a sample of BigNumber values.
//  *
//  * @param {import('bignumber.js').BigNumber[]} values - A sample of BigNumber
//  * values. The array will be sorted in place.
//  * @returns {import('bignumber.js').BigNumber} The median of the sample.
//  */
// export function getMedian(values) {
//   if (!Array.isArray(values) || values.length === 0) {
//     throw new Error('Expected non-empty array param.')
//   }

//   values.sort((a, b) => {
//     if (a.equals(b)) {
//       return 0
//     }
//     return a.lessThan(b) ? -1 : 1
//   })

//   if (values.length % 2 === 1) {
//     // return middle value
//     return values[(values.length - 1) / 2]
//   }

//   // return mean of middle two values
//   const upperIndex = values.length / 2
//   return values[upperIndex].plus(values[upperIndex - 1]).dividedBy(2)
// }
