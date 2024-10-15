const axios = require('axios');
const WebSocket = require('ws');

const HTTP_SERVER_URL = 'http://localhost:3000';
const WS_SERVER_URL = 'ws://localhost:3001';

describe('Trading System Tests', () => {
  let ws;

  beforeAll((done) => {
    ws = new WebSocket(WS_SERVER_URL);
    ws.on('open', done);
  });

  afterAll(() => {
    ws.close();
  });

  beforeEach(async () => {
    // Reset the system before each test
    await axios.post(`${HTTP_SERVER_URL}/reset`);
  });

  const waitForWSMessage = () => {
    return new Promise((resolve) => {
      ws.once('message', (data) => {
        resolve(JSON.parse(data));
      });
    });
  };

  test('Create user, onramp INR, and check balance', async () => {
    const userId = 'testUser1';
    await axios.post(`${HTTP_SERVER_URL}/user/create/${userId}`);
    
    const onrampResponse = await axios.post(`${HTTP_SERVER_URL}/onramp/inr`, {
      userId: userId,
      amount: 1000000 // 10,000 INR in paise
    });
    expect(onrampResponse.status).toBe(200);

    const balanceResponse = await axios.get(`${HTTP_SERVER_URL}/balance/inr/${userId}`);
    expect(balanceResponse.data).toEqual({ balance: 1000000, locked: 0 });
  });

  test('Create symbol and check orderbook', async () => {
    const symbol = 'TEST_SYMBOL_30_Dec_2024';
    await axios.post(`${HTTP_SERVER_URL}/symbol/create/${symbol}`);

    const orderbookResponse = await axios.get(`${HTTP_SERVER_URL}/orderbook/${symbol}`);
    expect(orderbookResponse.data).toEqual({ yes: {}, no: {} });
  });

  test('Place buy order for yes stock and check WebSocket response', async () => {
    const userId = 'testUser2';
    const symbol = 'BTC_USDT_10_Oct_2024_9_30';
    await axios.post(`${HTTP_SERVER_URL}/user/create/${userId}`);
    await axios.post(`${HTTP_SERVER_URL}/symbol/create/${symbol}`);
    await axios.post(`${HTTP_SERVER_URL}/onramp/inr`, { userId, amount: 1000000 });

    const buyOrderPromise = axios.post(`${HTTP_SERVER_URL}/order/buy`, {
      userId,
      stockSymbol: symbol,
      quantity: 100,
      price: 1000,
      stockType: 'yes'
    });

    const wsMessage = await waitForWSMessage();
    const buyOrderResponse = await buyOrderPromise;

    expect(buyOrderResponse.status).toBe(200);
    expect(wsMessage[0]).toMatch(/^event_orderbook_\d+$/);
    expect(wsMessage[1][symbol].yes['1000']).toEqual({
      total: 100,
      orders: { [userId]: 100 }
    });
  });

  test('Place sell order for no stock and check WebSocket response', async () => {
    const userId = 'testUser3';
    const symbol = 'ETH_USDT_15_Nov_2024_14_00';
    await axios.post(`${HTTP_SERVER_URL}/user/create/${userId}`);
    await axios.post(`${HTTP_SERVER_URL}/symbol/create/${symbol}`);
    await axios.post(`${HTTP_SERVER_URL}/trade/mint`, {
      userId,
      stockSymbol: symbol,
      quantity: 200
    });

    const sellOrderPromise = axios.post(`${HTTP_SERVER_URL}/order/sell`, {
      userId,
      stockSymbol: symbol,
      quantity: 100,
      price: 1100,
      stockType: 'no'
    });

    const wsMessage = await waitForWSMessage();
    const sellOrderResponse = await sellOrderPromise;

    expect(sellOrderResponse.status).toBe(200);
    expect(wsMessage[0]).toMatch(/^event_orderbook_\d+$/);
    expect(wsMessage[1][symbol].no['1100']).toEqual({
      total: 100,
      orders: { [userId]: 100 }
    });
  });

  test('Execute matching orders and check WebSocket response', async () => {
    const buyerId = 'buyer1';
    const sellerId = 'seller1';
    const symbol = 'AAPL_USDT_20_Jan_2025_10_00';
    const price = 950;
    const quantity = 50;

    // Setup users and symbol
    await axios.post(`${HTTP_SERVER_URL}/user/create/${buyerId}`);
    await axios.post(`${HTTP_SERVER_URL}/user/create/${sellerId}`);
    await axios.post(`${HTTP_SERVER_URL}/symbol/create/${symbol}`);
    await axios.post(`${HTTP_SERVER_URL}/onramp/inr`, { userId: buyerId, amount: 1000000 });
    await axios.post(`${HTTP_SERVER_URL}/trade/mint`, {
      userId: sellerId,
      stockSymbol: symbol,
      quantity: 100
    });

    // Place sell order
    await axios.post(`${HTTP_SERVER_URL}/order/sell`, {
      userId: sellerId,
      stockSymbol: symbol,
      quantity,
      price,
      stockType: 'yes'
    });

    // Place matching buy order
    const buyOrderPromise = axios.post(`${HTTP_SERVER_URL}/order/buy`, {
      userId: buyerId,
      stockSymbol: symbol,
      quantity,
      price,
      stockType: 'yes'
    });

    // Wait for two WebSocket messages (one for sell, one for execution)
    await waitForWSMessage();
    const executionWsMessage = await waitForWSMessage();
    await buyOrderPromise;

    // Check if orders are removed from the orderbook
    expect(executionWsMessage[0]).toMatch(/^event_orderbook_\d+$/);
    expect(executionWsMessage[1][symbol].yes[price]).toBeUndefined();

    // Check final balances
    const buyerStockBalance = await axios.get(`${HTTP_SERVER_URL}/balance/stock/${buyerId}`);
    const sellerInrBalance = await axios.get(`${HTTP_SERVER_URL}/balance/inr/${sellerId}`);

    expect(buyerStockBalance.data[symbol].yes.quantity).toBe(quantity);
    expect(sellerInrBalance.data.balance).toBe(price * quantity);
  });
});