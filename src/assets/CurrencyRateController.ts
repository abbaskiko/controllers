import { createSlice } from '@reduxjs/toolkit';

import { fetchExchangeRate as defaultFetchExchangeRate } from '../crypto-compare';

const name = 'CurrencyRateController';

const POLLING_INTERVAL = 180000;

/**
 * @type CurrencyRateState
 *
 * Currency rate controller state
 *
 * @property conversionDate - Timestamp of conversion rate expressed in ms since UNIX epoch
 * @property conversionRate - Conversion rate from current base asset to the current currency
 * @property currentCurrency - Currently-active ISO 4217 currency code
 * @property nativeCurrency - Symbol for the base asset used for conversion
 * @property pendingCurrentCurrency - The currency being switched to
 * @property pendingNativeCurrency - The base asset currency being switched to
 */
export interface CurrencyRateState {
  conversionDate: number;
  conversionRate: number;
  currentCurrency: string;
  nativeCurrency: string;
  pendingCurrentCurrency: string | null;
  pendingNativeCurrency: string | null;
  pollingStartTime?: number;
  updateStartTime?: number;
}

const initialState: CurrencyRateState = {
  conversionDate: 0,
  conversionRate: 0,
  currentCurrency: 'usd',
  nativeCurrency: 'ETH',
  pendingCurrentCurrency: null,
  pendingNativeCurrency: null,
  pollingStartTime: undefined,
  updateStartTime: undefined,
};

export const schema = {
  conversionDate: { persist: true, anonymous: true },
  conversionRate: { persist: true, anonymous: true },
  currentCurrency: { persist: true, anonymous: true },
  nativeCurrency: { persist: true, anonymous: true },
  pendingCurrentCurrency: { persist: false, anonymous: true },
  pendingNativeCurrency: { persist: false, anonymous: true },
  pollingStartTime: { persist: false, anonymous: true },
  updateStartTime: { persist: false, anonymous: true },
};

const slice = createSlice({
  name,
  initialState,
  reducers: {
    pollingStarted: (state, action) => {
      state.pollingStartTime = action.payload;
    },
    pollingStopped: (state) => {
      state.pollingStartTime = undefined;
    },
    pollFinished: (state, action) => {
      const conversionRate = action.payload;
      state.conversionDate = Date.now();
      state.conversionRate = conversionRate;
    },
    updateCurrencyStarted: (state, action) => {
      const { currentCurrency, nativeCurrency, updateStartTime } = action.payload;
      if (!currentCurrency && !nativeCurrency) {
        throw new Error('Missing currency; either current or native currency must be specified');
      }
      if (currentCurrency) {
        state.pendingCurrentCurrency = currentCurrency;
      }
      if (nativeCurrency) {
        state.pendingNativeCurrency = nativeCurrency;
      }
      state.updateStartTime = updateStartTime;
    },
    updateCurrencyFailed: (state) => {
      state.pendingCurrentCurrency = null;
      state.pendingNativeCurrency = null;
    },
    updateCurrencyFinished: (state, action) => {
      const conversionRate = action.payload;
      state.conversionDate = Date.now();
      state.conversionRate = conversionRate;
      if (state.pendingCurrentCurrency) {
        state.currentCurrency = state.pendingCurrentCurrency;
        state.pendingCurrentCurrency = null;
      }
      if (state.pendingCurrentCurrency) {
        state.nativeCurrency = state.pendingCurrentCurrency;
        state.pendingNativeCurrency = null;
      }
    },
  },
});

const { actions, reducer } = slice;

export default reducer;

// Selectors

const getPollingStartTime = (state: { [name]: CurrencyRateState }) => state[name].pollingStartTime;
const getCurrentCurrency = (state: { [name]: CurrencyRateState }) => state[name].currentCurrency;
const getNativeCurrency = (state: { [name]: CurrencyRateState }) => state[name].nativeCurrency;
const getPendingOrActiveCurrentCurrency = (state: { [name]: CurrencyRateState }) => state[name].pendingCurrentCurrency || getCurrentCurrency(state);
const getPendingOrActiveNativeCurrency = (state: { [name]: CurrencyRateState }) => state[name].pendingNativeCurrency || getNativeCurrency(state);
const getUpdateStartTime = (state: { [name]: CurrencyRateState }) => state[name].updateStartTime;

// Action creators

const {
  pollingStarted,
  pollingStopped,
  pollFinished,
  updateCurrencyStarted,
  updateCurrencyFailed,
  updateCurrencyFinished,
} = actions;

async function poll(
  dispatch: any,
  getState: () => { CurrencyRateController: CurrencyRateState },
  fetchExchangeRate = defaultFetchExchangeRate,
) {
  const state = getState();
  const currentCurrency = getCurrentCurrency(state);
  const nativeCurrency = getNativeCurrency(state);

  const fetchStartTime = Date.now();
  const conversionRate = await fetchExchangeRate(
    currentCurrency,
    nativeCurrency,
  );

  // bail if polling has stopped or restarted
  const updatedState = getState();
  const pollingStartTime = getPollingStartTime(updatedState);
  if (pollingStartTime === undefined || pollingStartTime > fetchStartTime) {
    return;
  }

  dispatch(pollFinished(conversionRate));
}

export function start(fetchExchangeRate = defaultFetchExchangeRate) {
  return async (dispatch: any, getState: () => { [name]: CurrencyRateState }) => {
    const pollingStartTime = Date.now();
    dispatch(pollingStarted(pollingStartTime));
    poll(dispatch, getState, fetchExchangeRate);

    const intervalHandle = setInterval(
      () => {
        const state = getState();
        const updatedPollingStartTime = getPollingStartTime(state);
        if (pollingStartTime !== updatedPollingStartTime) {
          clearInterval(intervalHandle);
          return;
        }
        poll(dispatch, getState, fetchExchangeRate);
      },
      POLLING_INTERVAL,
    );
  };
}

export function stop() {
  pollingStopped();
}

export function updateCurrency(
  { currentCurrency, nativeCurrency }: { currentCurrency: string; nativeCurrency: string },
  fetchExchangeRate = defaultFetchExchangeRate,
) {
  return async (dispatch: any, getState: () => { [name]: CurrencyRateState }) => {
    if (!currentCurrency && !nativeCurrency) {
      throw new Error('Missing currency; either current or native currency must be specified');
    }

    dispatch(stop());
    const updateStartTime = Date.now();
    dispatch(updateCurrencyStarted({ currentCurrency, nativeCurrency, updateStartTime }));

    let updateReplaced = false;

    try {
      const state = getState();
      const pendingOrActiveCurrentCurrency = getPendingOrActiveCurrentCurrency(state);
      const pendingOrActiveNativeCurrency = getPendingOrActiveNativeCurrency(state);

      const conversionRate = await fetchExchangeRate(
        pendingOrActiveCurrentCurrency,
        pendingOrActiveNativeCurrency,
      );

      // bail if another update has started already
      const updatedState = getState();
      const updatedUpdateStartTime = getUpdateStartTime(updatedState);
      if (updateStartTime !== updatedUpdateStartTime) {
        updateReplaced = true;
      } else {
        dispatch(updateCurrencyFinished(conversionRate));
      }
    } catch (error) {
      if (!updateReplaced) {
        dispatch(updateCurrencyFailed());
      }
      throw error;
    } finally {
      if (!updateReplaced) {
        dispatch(start(fetchExchangeRate));
      }
    }
  };
}
