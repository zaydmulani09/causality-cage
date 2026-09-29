// Teashop: a tiny checkout with planted defects. window.__BUG__ (from /runtime-config.js) picks one.
// Every defect is a line guarded by `BUG === '...'`; with BUG=none the same code path is safe.
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';

declare global {
  interface Window {
    __BUG__?: string;
    __SERVER__?: { inventoryLock?: boolean };
  }
}

const BUG = window.__BUG__ ?? 'none';

interface Item { sku: string; name: string; qty: number; price_ref: string }
interface Cart {
  id: string;
  customer: { id: string; name: string; tax_id: string | null };
  items: Item[];
  currency?: string;
  discount: { code: string; pct: number } | null;
}
type Prices = Record<string, number>;

const FALLBACK_PRICES: Prices = { p1: 11, p2: 16 };
const CURRENCIES: Record<string, { symbol: string }> = { USD: { symbol: '$' }, EUR: { symbol: '€' }, GBP: { symbol: '£' } };
const EXPERIMENTS: Record<string, { discountRate: number }> = { v1: { discountRate: 0.1 }, v2: { discountRate: 0.15 } };
const REGIONS: Record<string, { vat: number }> = { us: { vat: 0 }, uk: { vat: 0.2 } };
const LOCALES: Record<string, { greeting: string }> = { 'en-US': { greeting: 'Signed in as' }, 'de-DE': { greeting: 'Angemeldet als' } };

async function getJson<T>(url: string): Promise<{ data: T; headers: Headers }> {
  const res = await fetch(url);
  return { data: (await res.json()) as T, headers: res.headers };
}

function cookie(name: string): string | null {
  const hit = document.cookie.split('; ').find((c) => c.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) return <div role="alert">Something went wrong: {this.state.error.message}</div>;
    return this.props.children;
  }
}

export function App() {
  const [page, setPage] = useState<'home' | 'checkout'>('home');
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Teashop</h1>
      <Boundary>{page === 'home' ? <Home onCheckout={() => setPage('checkout')} /> : <Checkout />}</Boundary>
    </main>
  );
}

function Home({ onCheckout }: { onCheckout: () => void }) {
  const [products, setProducts] = useState<{ sku: string; name: string }[] | null>(null);
  useEffect(() => {
    getJson<{ products: { sku: string; name: string }[] }>('/api/products').then((r) => setProducts(r.data.products));
  }, []);
  if (!products) return <p>Loading…</p>;
  return (
    <>
      <ul>{products.map((p) => <li key={p.sku}>{p.name}</li>)}</ul>
      <button onClick={onCheckout}>Checkout</button>
    </>
  );
}

function Checkout() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [inventory, setInventory] = useState<Record<string, number> | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [profiles, setProfiles] = useState(0);
  const [staleTotal, setStaleTotal] = useState(false);
  const [pricesLate, setPricesLate] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [flaky] = useState(() => BUG === 'B7' && Math.random() < 0.3);
  const pricesRef = useRef<Prices | null>(null);
  const freshProfile = useRef(false);

  useEffect(() => {
    getJson<Cart>('/api/cart').then((r) => {
      setCart(r.data);
      setRegion(r.headers.get('x-region'));
    });
    getJson<Prices>('/api/prices').then((r) => {
      pricesRef.current = r.data;
      setPrices(r.data);
    });
    getJson<Record<string, number>>('/api/inventory').then((r) => setInventory(r.data));
    getJson<{ name: string }>('/api/profile').then((r) => {
      freshProfile.current = true;
      setName(r.data.name);
      setProfiles((n) => n + 1);
    });
    getJson<{ name: string }>('/api/profile-cache').then((r) => {
      // Cached profile only fills in while the fresh one is pending. B4: last write wins.
      if (BUG === 'B4' || !freshProfile.current) setName(r.data.name);
      setProfiles((n) => n + 1);
    });
  }, []);

  // Quote freeze: if prices lag inventory by 800 ms, show fallback prices. B3 never unfreezes.
  useEffect(() => {
    if (!inventory) return;
    const t = setTimeout(() => {
      if (!pricesRef.current) setStaleTotal(true);
    }, 800);
    return () => clearTimeout(t);
  }, [inventory]);
  useEffect(() => {
    if (prices && BUG !== 'B3') setStaleTotal(false);
  }, [prices]);

  // Tax estimate while prices are late (700 ms after the cart arrives).
  useEffect(() => {
    if (!cart) return;
    const t = setTimeout(() => {
      if (!pricesRef.current) setPricesLate(true);
    }, 700);
    return () => clearTimeout(t);
  }, [cart]);

  if (flaky) throw new Error('Flaky recommendations widget failed');
  if (BUG === 'B8' && window.__SERVER__?.inventoryLock) throw new Error('Inventory lock held by another session');
  if (!cart) return <p>Loading cart…</p>;

  const taxId = BUG === 'B1' || BUG === 'B7' ? (cart.customer.tax_id as string).toUpperCase() : (cart.customer.tax_id ?? '—').toUpperCase();
  const currencyCode = cart.currency || 'USD';
  const currency = BUG === 'B5' ? CURRENCIES[currencyCode]!.symbol : (CURRENCIES[currencyCode]?.symbol ?? currencyCode + ' ');

  let discountRate = 0;
  if (cart.discount?.code) {
    const exp = localStorage.getItem('exp_assignment') ?? 'v1';
    discountRate = BUG === 'B2' ? EXPERIMENTS[exp]!.discountRate : (EXPERIMENTS[exp]?.discountRate ?? cart.discount.pct / 100);
  }

  let vat = 0;
  if (region) vat = BUG === 'B6' ? REGIONS[region]!.vat : (REGIONS[region]?.vat ?? 0);
  const locale = cookie('locale') ?? 'en-US';
  const greeting = BUG === 'B6' ? LOCALES[locale]!.greeting : (LOCALES[locale]?.greeting ?? 'Signed in as');

  const priceList = staleTotal ? FALLBACK_PRICES : prices;
  const subtotal = priceList ? cart.items.reduce((s, i) => s + i.qty * (priceList[i.price_ref] ?? 0), 0) : null;
  const total = subtotal === null ? null : subtotal * (1 - discountRate) * (1 + vat);

  let estimate: string | null = null;
  if (pricesLate && !prices) {
    const tid = cart.customer.tax_id;
    estimate = BUG === 'demo' ? (tid as string).slice(0, 2) : (tid ?? '').slice(0, 2) || 'n/a';
  }

  const ready = prices !== null && total !== null && inventory !== null && profiles === 2;

  async function place() {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cart: cart!.id, total }),
    });
    setOrderId(((await res.json()) as { orderId: string }).orderId);
  }

  return (
    <section>
      <p>{greeting} {name ?? '…'}</p>
      <p>Customer: {cart.customer.name} (tax id {taxId})</p>
      <ul>
        {cart.items.map((i) => (
          <li key={i.sku}>
            {i.qty} × {i.name} {inventory ? `(${inventory[i.sku] ?? 0} in stock)` : ''}
          </li>
        ))}
      </ul>
      {estimate && <p>Estimated tax region: {estimate}</p>}
      <p>Total: {total === null ? 'calculating…' : currency + total.toFixed(2)}</p>
      {ready && !orderId && <button onClick={place}>Place order</button>}
      {orderId && <p>Order placed: {orderId}</p>}
    </section>
  );
}
