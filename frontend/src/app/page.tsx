"use client";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import Tesseract from "tesseract.js";

const BarcodeScanner = dynamic(() => import("@/components/BarcodeScanner"), { ssr: false });

// ─── Interfaces ──────────────────────────────────────────────────────────────
interface FoodItem {
  id: number;
  name: string;
  category: string;
  purchase_date: string;
  expiry_date: string;
  is_consumed: boolean;
}

// ─── Category Visual Definitions ──────────────────────────────────────────────
const CATEGORIES: Record<string, { bg: string; text: string; dot: string; icon: string }> = {
  Dairy:     { bg: "bg-blue-500/10 border-blue-500/30",   text: "text-blue-400",   dot: "bg-blue-400", icon: "🥛" },
  Produce:   { bg: "bg-emerald-500/10 border-emerald-500/30", text: "text-emerald-400", dot: "bg-emerald-400", icon: "🥬" },
  Meat:      { bg: "bg-rose-500/10 border-rose-500/30",   text: "text-rose-400",   dot: "bg-rose-400", icon: "🥩" },
  Pantry:    { bg: "bg-amber-500/10 border-amber-500/30", text: "text-amber-300", dot: "bg-amber-400", icon: "🥫" },
  Beverages: { bg: "bg-cyan-500/10 border-cyan-500/30",   text: "text-cyan-400",   dot: "bg-cyan-400", icon: "🧃" },
  Frozen:    { bg: "bg-indigo-500/10 border-indigo-500/30", text: "text-indigo-400", dot: "bg-indigo-400", icon: "🧊" },
  Snacks:    { bg: "bg-purple-500/10 border-purple-500/30", text: "text-purple-400", dot: "bg-purple-400", icon: "🥨" },
  Scanned:   { bg: "bg-violet-500/10 border-violet-500/30", text: "text-violet-400", dot: "bg-violet-400", icon: "🧾" },
  General:   { bg: "bg-slate-500/10 border-slate-500/30", text: "text-slate-300", dot: "bg-slate-400", icon: "🍽️" },
};
const getCategoryStyle = (c: string) => CATEGORIES[c] ?? CATEGORIES["General"];

// ─── Expiry Utilities ────────────────────────────────────────────────────────
function getDaysLeft(expiry: string) {
  const diffTime = new Date(expiry + "T00:00:00").getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.ceil(diffTime / 86400000);
}

function getExpiryBadge(days: number) {
  if (days < 0) {
    return {
      label: `Expired ${Math.abs(days)}d ago`,
      badgeClass: "bg-rose-500/15 text-rose-300 border-rose-500/40",
      dotClass: "bg-rose-400 animate-pulse",
    };
  }
  if (days === 0) {
    return {
      label: "Expires today!",
      badgeClass: "bg-red-500/20 text-red-300 border-red-500/50 font-bold",
      dotClass: "bg-red-400 animate-ping",
    };
  }
  if (days === 1) {
    return {
      label: "Expires tomorrow",
      badgeClass: "bg-amber-500/20 text-amber-200 border-amber-500/40 font-semibold",
      dotClass: "bg-amber-400",
    };
  }
  if (days <= 3) {
    return {
      label: `${days} days left`,
      badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/30",
      dotClass: "bg-amber-400",
    };
  }
  return {
    label: `${days} days left`,
    badgeClass: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    dotClass: "bg-emerald-400",
  };
}

// ─── Food OCR Allowlist ──────────────────────────────────────────────────────
const FOOD_WORDS = new Set([
  "milk","cheese","butter","cream","paneer","ghee","curd","dahi",
  "egg","eggs","bread","roti","naan","paratha","bun","toast",
  "apple","banana","mango","orange","grape","grapes","lemon","lime",
  "strawberry","papaya","watermelon","melon","guava","pomegranate",
  "tomato","potato","onion","carrot","spinach","palak","cucumber","pepper","capsicum",
  "broccoli","cauliflower","cabbage","celery","garlic","ginger","adrak","corn","peas","matar",
  "beans","lentil","dal","daal","mushroom","zucchini","eggplant","baingan","radish","beetroot",
  "chicken","mutton","fish","salmon","prawns","shrimp","beef","pork","egg",
  "rice","basmati","atta","flour","pasta","noodle","maggi","oats","poha","suji","rava",
  "juice","tea","chai","coffee","oil","mustard","ketchup","sauce","honey",
  "biscuit","cookies","chocolate","chips","namkeen","cashew","kaju","badam","almond"
]);

function isFoodWord(w: string) {
  const lw = w.toLowerCase();
  if (FOOD_WORDS.has(lw)) return true;
  for (const f of FOOD_WORDS) {
    if (lw.includes(f) || f.includes(lw)) return true;
  }
  return false;
}

function parseReceipt(raw: string): string[] {
  const found: string[] = [];
  for (const line of raw.split("\n")) {
    const letters = line.replace(/[^a-zA-Z\s]/g, "").trim();
    if (letters.length < 3) continue;
    const words = letters.match(/[a-zA-Z]{3,}/g);
    if (!words) continue;
    const food = words.filter(isFoodWord);
    if (!food.length) continue;
    const name = food.slice(0, 3).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

async function lookupBarcode(barcode: string): Promise<{ name: string; category: string } | null> {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const data = await res.json();
    if (data.status !== 1) return null;
    const p = data.product;
    const name: string = p.product_name_en || p.product_name || "Unknown Product";
    const raw: string = (p.categories || "").toLowerCase();
    let category = "Pantry";
    if (raw.includes("dairy") || raw.includes("milk") || raw.includes("cheese")) category = "Dairy";
    else if (raw.includes("meat") || raw.includes("poultry") || raw.includes("fish")) category = "Meat";
    else if (raw.includes("fruit") || raw.includes("vegetable") || raw.includes("produce")) category = "Produce";
    else if (raw.includes("beverage") || raw.includes("drink") || raw.includes("tea")) category = "Beverages";
    else if (raw.includes("snack") || raw.includes("biscuit") || raw.includes("chip")) category = "Snacks";
    else if (raw.includes("frozen")) category = "Frozen";
    return { name, category };
  } catch {
    return null;
  }
}

const todayStr = () => new Date().toISOString().split("T")[0];
const inDaysStr = (days: number) => new Date(Date.now() + days * 86400000).toISOString().split("T")[0];

// ─── Main Component ──────────────────────────────────────────────────────────
export default function Home() {
  const [items, setItems] = useState<FoodItem[]>([]);
  const [inventoryFilter, setInventoryFilter] = useState<"active" | "consumed" | "all">("active");
  const [rightTab, setRightTab] = useState<"inventory" | "shopping">("inventory");

  // Form
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState("Produce");
  const [newExpiry, setNewExpiry] = useState(inDaysStr(5));

  // Scanners
  const [isScanning, setIsScanning] = useState(false);
  const [rawOcr, setRawOcr] = useState("");
  const [scannedPreview, setScannedPreview] = useState<string[]>([]);
  const [showBarcode, setShowBarcode] = useState(false);
  const [barcodeLoading, setBarcodeLoading] = useState(false);

  // Recipe
  const [recipe, setRecipe] = useState("");
  const [recipeLoading, setRecipeLoading] = useState(false);

  // Modals
  const [showReset, setShowReset] = useState(false);
  const [showNotificationModal, setShowNotificationModal] = useState(false);

  // Phone / Notification Setup
  const [phoneNumber, setPhoneNumber] = useState("");
  const [callMeBotKey, setCallMeBotKey] = useState("");
  const [autoNotify, setAutoNotify] = useState(true);
  const [notifyStatus, setNotifyStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [sendingAlert, setSendingAlert] = useState(false);
  const [autoAlertTriggered, setAutoAlertTriggered] = useState(false);

  // Load items & preferences on mount
  useEffect(() => {
    fetch("/api/items")
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d) ? d : []))
      .catch(console.error);

    const savedPhone = localStorage.getItem("freshtrack_phone");
    if (savedPhone) setPhoneNumber(savedPhone);

    const savedCmbKey = localStorage.getItem("freshtrack_cmb_key");
    if (savedCmbKey) setCallMeBotKey(savedCmbKey);

    const savedAuto = localStorage.getItem("freshtrack_auto_notify");
    if (savedAuto !== null) setAutoNotify(savedAuto === "true");
  }, []);

  // Save phone number & trigger automatic background expiry check
  const savePhoneSettings = (num: string, auto: boolean) => {
    setPhoneNumber(num);
    setAutoNotify(auto);
    localStorage.setItem("freshtrack_phone", num);
    localStorage.setItem("freshtrack_auto_notify", String(auto));
  };

  // Automated background notification scheduler: 2 checks per day (Morning ~9AM, Evening ~6PM)
  // Targets items expiring TODAY or TOMORROW (daysLeft <= 1)
  useEffect(() => {
    if (!autoNotify || !phoneNumber.trim() || items.length === 0) return;

    // Filter strictly for items expiring TODAY (0), TOMORROW (1), or already expired (<0)
    const criticalUrgent = items.filter(i => !i.is_consumed && getDaysLeft(i.expiry_date) <= 1);
    if (criticalUrgent.length === 0) return;

    const todayDate = todayStr();
    const currentHour = new Date().getHours();
    // Slot 1: Morning (before 2PM), Slot 2: Evening (2PM onwards) -> 2 automated alert windows per day
    const alertSlot = currentHour < 14 ? "morning" : "evening";
    const slotKey = `freshtrack_auto_alert_${todayDate}_${alertSlot}`;

    const alreadySentForThisSlot = localStorage.getItem(slotKey);
    if (alreadySentForThisSlot) return;

    // Record that alert for this half of the day has been triggered
    localStorage.setItem(slotKey, "true");
    setAutoAlertTriggered(true);

    const expired = criticalUrgent.filter(i => getDaysLeft(i.expiry_date) < 0);
    const expiringTomorrowOrToday = criticalUrgent.filter(i => getDaysLeft(i.expiry_date) >= 0);

    let urgentTitle = "";
    let urgentMsg = "";

    if (expiringTomorrowOrToday.length > 0) {
      urgentTitle = `⚠️ Expiry Alert: ${expiringTomorrowOrToday.length} item(s) expire by tomorrow!`;
      urgentMsg = `FreshTrack: ${expiringTomorrowOrToday.map(i => `${i.name} (${getDaysLeft(i.expiry_date) === 0 ? "Today" : "Tomorrow"})`).join(", ")} expire within 24-48 hours. Please consume them soon!`;
    } else {
      urgentTitle = `🚨 ${expired.length} item(s) already expired!`;
      urgentMsg = `FreshTrack: ${expired.map(i => i.name).join(", ")} have expired.`;
    }

    // 1. Dispatch Native Browser Notification (if permission active)
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification(urgentTitle, {
        body: urgentMsg,
        icon: "/favicon.ico",
        requireInteraction: true,
      });
    }

    // 2. Dispatch automated server-side notification attempt (CallMeBot WhatsApp / Fast2SMS / Twilio)
    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: phoneNumber.trim(),
        message: urgentMsg,
        callmebotApiKey: localStorage.getItem("freshtrack_cmb_key") || "",
      }),
    }).catch(err => console.error("Auto-notify background error:", err));
  }, [items, autoNotify, phoneNumber]);

  // Manual or Auto Alert Dispatcher
  const handleSendNotification = async (channel: "whatsapp" | "sms" = "whatsapp") => {
    if (!phoneNumber.trim()) {
      setNotifyStatus({ type: "error", msg: "Please enter your 10-digit Indian mobile number." });
      return;
    }

    setSendingAlert(true);
    setNotifyStatus(null);
    savePhoneSettings(phoneNumber.trim(), autoNotify);

    const expiring = items.filter(i => !i.is_consumed && getDaysLeft(i.expiry_date) <= 3 && getDaysLeft(i.expiry_date) >= 0);
    const expired  = items.filter(i => !i.is_consumed && getDaysLeft(i.expiry_date) < 0);

    let alertMessage = "";
    if (expired.length > 0 && expiring.length > 0) {
      alertMessage = `🚨 FreshTrack Alert:\n• Expired: ${expired.map(i => i.name).join(", ")}\n• Expiring soon (≤3 days): ${expiring.map(i => `${i.name} (${getDaysLeft(i.expiry_date)}d left)`).join(", ")}\n\nPlease consume or freeze them soon to avoid waste!`;
    } else if (expired.length > 0) {
      alertMessage = `🚨 FreshTrack Alert:\nThe following item(s) have expired: ${expired.map(i => i.name).join(", ")}. Please use or discard them.`;
    } else if (expiring.length > 0) {
      alertMessage = `⏰ FreshTrack Expiry Alert:\n${expiring.length} grocery item(s) are expiring within 3 days:\n${expiring.map(i => `• ${i.name} (${getDaysLeft(i.expiry_date)} day(s) left)`).join("\n")}\n\nTime to cook something delicious!`;
    } else {
      alertMessage = `✅ FreshTrack Update: Good news! All items in your household inventory are fresh. None are expiring in the next 3 days.`;
    }

    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phoneNumber.trim(),
          message: alertMessage,
          callmebotApiKey: callMeBotKey,
        }),
      });
      const data = await res.json();

      if (channel === "whatsapp") {
        if (data.whatsappUrl) {
          window.open(data.whatsappUrl, "_blank");
          setNotifyStatus({
            type: "success",
            msg: `WhatsApp opened for ${data.phone}! Click 'Send' in WhatsApp to deliver your expiry alert directly to your phone.`
          });
        }
      } else {
        if (data.success) {
          setNotifyStatus({
            type: "success",
            msg: `SMS delivered via SMS gateway to ${data.phone}.`
          });
        } else {
          setNotifyStatus({
            type: "error",
            msg: data.carrierNotice || "Free international SMS gateways are blocked by Indian telecom operators (TRAI DLT). Please click 'Send WhatsApp Alert' above to receive notifications instantly on your phone!"
          });
        }
      }
    } catch {
      setNotifyStatus({ type: "error", msg: "Network error sending notification." });
    } finally {
      setSendingAlert(false);
    }
  };

  // CRUD helpers
  const apiPost = async (body: object): Promise<FoodItem | null> => {
    const res = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    return null;
  };

  const handleAdd = async () => {
    if (!newName.trim() || !newExpiry) return;
    const item = await apiPost({
      name: newName.trim(),
      category: newCat,
      purchase_date: todayStr(),
      expiry_date: newExpiry,
    });
    if (item) {
      setItems(prev => [...prev, item]);
      setNewName("");
      setNewExpiry(inDaysStr(5));
    }
  };

  const handleToggleConsumed = async (id: number, current: boolean) => {
    const res = await fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_consumed: !current }),
    });
    if (res.ok) {
      const updated: FoodItem = await res.json();
      setItems(prev => prev.map(i => i.id === id ? updated : i));
    }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
    if (res.ok) setItems(prev => prev.filter(i => i.id !== id));
  };

  const handleReset = async () => {
    const res = await fetch("/api/items", { method: "DELETE" });
    if (res.ok) {
      setItems([]);
      setShowReset(false);
    }
  };

  const handleBuyAgain = async (item: FoodItem) => {
    await handleDelete(item.id);
    const newItem = await apiPost({
      name: item.name,
      category: item.category,
      purchase_date: todayStr(),
      expiry_date: inDaysStr(7),
    });
    if (newItem) setItems(prev => [...prev, newItem]);
  };

  const handleBarcodeDetect = async (barcode: string) => {
    setShowBarcode(false);
    setBarcodeLoading(true);
    const product = await lookupBarcode(barcode);
    setBarcodeLoading(false);
    if (product) {
      setNewName(product.name);
      setNewCat(product.category);
    } else {
      setNewName(`Product (${barcode})`);
      alert("Product details not found in database. Please enter item name manually.");
    }
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setIsScanning(true);
    setRawOcr("");
    setScannedPreview([]);
    try {
      const result = await Tesseract.recognize(e.target.files[0], "eng");
      setRawOcr(result.data.text);
      const found = parseReceipt(result.data.text);
      setScannedPreview(found);
      const saved: FoodItem[] = [];
      for (const name of found) {
        const item = await apiPost({
          name,
          category: "Scanned",
          purchase_date: todayStr(),
          expiry_date: inDaysStr(5),
        });
        if (item) saved.push(item);
      }
      if (saved.length) setItems(prev => [...prev, ...saved]);
      else alert("No food items detected. Ensure the receipt is well-lit and clear.");
    } catch {
      alert("Receipt scanning failed.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleGetRecipe = async () => {
    const active = items.filter(i => !i.is_consumed).sort((a, b) => getDaysLeft(a.expiry_date) - getDaysLeft(b.expiry_date));
    if (!active.length) return;
    setRecipeLoading(true);
    setRecipe("");
    try {
      const res = await fetch("/api/recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: active.slice(0, 6).map(i => i.name) }),
      });
      const data = await res.json();
      setRecipe(data.recipe || data.error || "No recipe generated.");
    } catch {
      setRecipe("Failed to generate recipe.");
    } finally {
      setRecipeLoading(false);
    }
  };

  // Calculations
  const activeItems   = useMemo(() => items.filter(i => !i.is_consumed), [items]);
  const consumedItems = useMemo(() => items.filter(i => i.is_consumed), [items]);
  const expiringItems = useMemo(() => activeItems.filter(i => getDaysLeft(i.expiry_date) <= 3 && getDaysLeft(i.expiry_date) >= 0), [activeItems]);
  const expiredItems  = useMemo(() => activeItems.filter(i => getDaysLeft(i.expiry_date) < 0), [activeItems]);
  const shoppingList  = useMemo(() => items.filter(i => i.is_consumed || getDaysLeft(i.expiry_date) <= 0), [items]);

  const filteredItems = useMemo(() => {
    if (inventoryFilter === "active")   return activeItems;
    if (inventoryFilter === "consumed") return consumedItems;
    return items;
  }, [items, activeItems, consumedItems, inventoryFilter]);

  return (
    <div className="min-h-screen bg-mesh-pattern text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
      
      {/* ── Brand Header with Vector Logo ─────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#0b0f17]/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
          
          {/* Logo & Brand Identity */}
          <div className="flex items-center gap-3.5">
            <div className="relative group cursor-pointer">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-500 via-teal-400 to-cyan-500 p-0.5 shadow-lg shadow-emerald-500/20 group-hover:shadow-emerald-500/40 transition-all duration-300">
                <div className="w-full h-full bg-[#0d1424] rounded-[14px] flex items-center justify-center">
                  <svg className="w-6 h-6 text-emerald-400 group-hover:scale-110 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a9 9 0 0 1 9 9c0 4.97-4.03 9-9 9A9 9 0 0 1 3 11a9 9 0 0 1 9-9z"/>
                    <path d="M12 7v5l3 3"/>
                    <circle cx="12" cy="12" r="2" fill="currentColor"/>
                  </svg>
                </div>
              </div>
              <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-[#0b0f17] flex items-center justify-center">
                <span className="w-1.5 h-1.5 bg-white rounded-full"></span>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                  FreshTrack
                </span>
                <span className="text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  AI Enterprise
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">Intelligent Household Food Expiration & Shelf-Life Platform</p>
            </div>
          </div>

          {/* Action Header Nav */}
          <div className="flex items-center gap-3">
            {/* Auto Notification / Indian Mobile Setup Button */}
            <button
              onClick={() => setShowNotificationModal(true)}
              className="relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 transition-all shadow-sm"
            >
              <span className="text-sm">🔔</span>
              <span>
                {phoneNumber ? `Auto-Alerts (${phoneNumber.slice(-4)})` : "Setup Phone Alerts"}
              </span>
              {autoNotify && phoneNumber && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              )}
            </button>

            {/* Reset Inventory Button */}
            <button
              onClick={() => setShowReset(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-white/5 hover:border-rose-500/20 transition-all"
            >
              <span>🔄</span>
              <span className="hidden sm:inline">Reset</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Content Container ────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 flex-1 w-full">

        {/* ── Dynamic Live Expiry Alert Banner ──────────────────────────────── */}
        {(expiringItems.length > 0 || expiredItems.length > 0) && (
          <div className="relative overflow-hidden rounded-2xl glass-panel p-5 border-amber-500/30 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xl shrink-0">
                  {expiredItems.length > 0 ? "🚨" : "⏰"}
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-sm sm:text-base flex items-center gap-2">
                    <span>
                      {expiredItems.length > 0
                        ? `${expiredItems.length} item(s) already expired & ${expiringItems.length} expiring soon!`
                        : `${expiringItems.length} grocery item(s) approaching expiration!`}
                    </span>
                  </h3>
                  <div className="text-xs text-slate-300 mt-1.5 flex flex-wrap gap-2">
                    {expiredItems.length > 0 && (
                      <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2.5 py-0.5 rounded-lg">
                        Expired: {expiredItems.map(i => i.name).join(", ")}
                      </span>
                    )}
                    {expiringItems.length > 0 && (
                      <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-lg">
                        Expiring ≤3d: {expiringItems.map(i => `${i.name} (${getDaysLeft(i.expiry_date)}d left)`).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
                <button
                  onClick={() => setShowNotificationModal(true)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors shadow-sm"
                >
                  📱 Send to WhatsApp
                </button>
                <button
                  onClick={handleGetRecipe}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/15 border border-white/15 text-slate-200 transition-colors"
                >
                  🍳 Cook Recipe
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Key Metrics Ribbon ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="glass-panel rounded-2xl p-4 sm:p-5 hover:border-white/15 transition-all">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <span>Total Inventory</span>
              <span className="text-base">📦</span>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-white mt-2">{items.length}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Household food items</p>
          </div>

          <div className="glass-panel rounded-2xl p-4 sm:p-5 hover:border-emerald-500/30 transition-all">
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-400 uppercase tracking-wider">
              <span>In Stock</span>
              <span className="text-base">🥗</span>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-emerald-400 mt-2">{activeItems.length}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Fresh & available to eat</p>
          </div>

          <div className="glass-panel rounded-2xl p-4 sm:p-5 hover:border-amber-500/30 transition-all">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-400 uppercase tracking-wider">
              <span>Expiring Soon</span>
              <span className="text-base">⏰</span>
            </div>
            <p className={`text-2xl sm:text-3xl font-black mt-2 ${expiringItems.length > 0 ? "text-amber-400" : "text-white"}`}>
              {expiringItems.length}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">Within 72 hours</p>
          </div>

          <div className="glass-panel rounded-2xl p-4 sm:p-5 hover:border-purple-500/30 transition-all">
            <div className="flex items-center justify-between text-xs font-semibold text-purple-400 uppercase tracking-wider">
              <span>Consumed</span>
              <span className="text-base">✅</span>
            </div>
            <p className="text-2xl sm:text-3xl font-black text-purple-400 mt-2">{consumedItems.length}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Safely saved from waste</p>
          </div>
        </div>

        {/* ── Main Two-Column Workspace ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* Left Column (Input Tools) - 4 Cols */}
          <div className="lg:col-span-4 space-y-5">
            
            {/* Quick Add Form */}
            <div className="glass-panel rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-white/5">
                <div className="flex items-center gap-2 font-bold text-sm text-white">
                  <span>➕</span>
                  <span>Add Groceries</span>
                </div>
                <button
                  onClick={() => setShowBarcode(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-500/10 text-purple-300 border border-purple-500/30 hover:bg-purple-500/20 transition-all"
                >
                  <span>📦</span>
                  <span>{barcodeLoading ? "Scanning..." : "Barcode"}</span>
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-400 mb-1 block">Item Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Greek Yogurt, Apples, Paneer"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleAdd()}
                    className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/40"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-400 mb-1 block">Category</label>
                    <select
                      value={newCat}
                      onChange={e => setNewCat(e.target.value)}
                      className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2.5 text-xs font-medium text-slate-200 focus:outline-none focus:border-emerald-500/60"
                    >
                      {Object.keys(CATEGORIES).filter(c => c !== "General" && c !== "Scanned").map(c => (
                        <option key={c} value={c} className="bg-slate-900 text-white">
                          {CATEGORIES[c].icon} {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400 mb-1 block">Expiry Date</label>
                    <input
                      type="date"
                      value={newExpiry}
                      onChange={e => setNewExpiry(e.target.value)}
                      className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/60"
                    />
                  </div>
                </div>

                <button
                  onClick={handleAdd}
                  disabled={!newName.trim()}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-40 text-slate-950 font-bold text-xs tracking-wide transition-all shadow-md shadow-emerald-500/10"
                >
                  Add to Inventory
                </button>
              </div>
            </div>

            {/* Receipt OCR Scanner */}
            <div className="glass-panel rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2 font-bold text-sm text-white">
                <span>🧾</span>
                <span>Scan Receipt Photo</span>
              </div>
              <p className="text-xs text-slate-400">
                Upload grocery bills to automatically extract grocery names via AI OCR.
              </p>

              <div className="relative">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleReceiptUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  disabled={isScanning}
                />
                <div className={`w-full py-4 px-4 rounded-xl border border-dashed flex flex-col items-center justify-center text-center transition-all ${
                  isScanning
                    ? "bg-slate-900/40 border-slate-700 text-slate-500"
                    : "bg-emerald-500/5 border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-400 cursor-pointer"
                }`}>
                  <span className="text-xl mb-1">{isScanning ? "⏳" : "📷"}</span>
                  <span className="text-xs font-semibold">
                    {isScanning ? "Extracting groceries with OCR..." : "Click or drag receipt image"}
                  </span>
                  <span className="text-[10px] text-slate-500 mt-0.5">Supports bill photos from store or supermart</span>
                </div>
              </div>

              {scannedPreview.length > 0 && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                  <p className="text-xs font-semibold text-emerald-400 mb-1.5">
                    ✅ Extracted {scannedPreview.length} item(s):
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {scannedPreview.map((n, i) => (
                      <span key={i} className="text-[11px] bg-slate-900/80 text-emerald-300 font-medium px-2 py-0.5 rounded-md border border-emerald-500/30">
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {rawOcr && (
                <details className="mt-2">
                  <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-400">
                    Show raw OCR text
                  </summary>
                  <pre className="mt-1.5 p-2 rounded-lg bg-slate-950/80 border border-white/5 text-[10px] text-slate-400 font-mono whitespace-pre-wrap max-h-24 overflow-y-auto">
                    {rawOcr}
                  </pre>
                </details>
              )}
            </div>

            {/* Zero-Waste AI Chef */}
            <div className="glass-panel rounded-2xl p-5 space-y-3 border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-sm text-amber-200">
                  <span>🍳</span>
                  <span>Zero-Waste AI Chef</span>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Gemini
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Suggests instant recipes incorporating items that are expiring first.
              </p>

              <button
                onClick={handleGetRecipe}
                disabled={recipeLoading || activeItems.length === 0}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-40 text-slate-950 font-bold text-xs tracking-wide transition-all shadow-md shadow-amber-500/10 flex items-center justify-center gap-2"
              >
                {recipeLoading ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin"></span>
                    <span>Crafting Recipe...</span>
                  </>
                ) : (
                  <>
                    <span>✨</span>
                    <span>Generate Recipe with Expiring Items</span>
                  </>
                )}
              </button>

              {recipe && (
                <div className="mt-3 p-3.5 rounded-xl bg-slate-950/80 border border-amber-500/30 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto font-mono">
                  {recipe}
                </div>
              )}
            </div>

          </div>

          {/* Right Column (Inventory & Restock) - 8 Cols */}
          <div className="lg:col-span-8">
            <div className="glass-panel rounded-2xl overflow-hidden">
              
              {/* Tab Header */}
              <div className="p-4 sm:px-6 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/[0.02]">
                <div className="flex items-center gap-1.5 bg-slate-900/80 p-1 rounded-xl border border-white/5 w-fit">
                  <button
                    onClick={() => setRightTab("inventory")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      rightTab === "inventory"
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Inventory ({items.length})
                  </button>
                  <button
                    onClick={() => setRightTab("shopping")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                      rightTab === "shopping"
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <span>Shopping Restock</span>
                    {shoppingList.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500 text-slate-950 font-bold">
                        {shoppingList.length}
                      </span>
                    )}
                  </button>
                </div>

                {rightTab === "inventory" && (
                  <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-xl border border-white/5 text-xs font-medium w-fit">
                    {(["active", "consumed", "all"] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setInventoryFilter(f)}
                        className={`px-2.5 py-1 rounded-lg capitalize transition-colors ${
                          inventoryFilter === f
                            ? "bg-white/10 text-white font-semibold"
                            : "text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        {f === "active" ? `Active (${activeItems.length})` : f === "consumed" ? `Consumed (${consumedItems.length})` : `All`}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Inventory List ── */}
              {rightTab === "inventory" && (
                filteredItems.length === 0 ? (
                  <div className="py-24 px-4 text-center">
                    <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl">
                      {inventoryFilter === "consumed" ? "🏷️" : "🛒"}
                    </div>
                    <p className="text-sm font-semibold text-slate-300">
                      {inventoryFilter === "consumed" ? "No consumed items recorded yet." : "Inventory is empty."}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {inventoryFilter !== "consumed" && "Add groceries manually or upload a receipt to track shelf life."}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {filteredItems.map(item => {
                      const days = getDaysLeft(item.expiry_date);
                      const badge = getExpiryBadge(days);
                      const cat = getCategoryStyle(item.category);

                      return (
                        <div
                          key={item.id}
                          className={`p-4 sm:px-6 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors ${
                            item.is_consumed ? "opacity-40" : ""
                          }`}
                        >
                          <div className="flex items-center gap-3.5 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-slate-900/90 border border-white/10 flex items-center justify-center text-lg shrink-0">
                              {cat.icon}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold truncate ${item.is_consumed ? "line-through text-slate-500" : "text-white"}`}>
                                  {item.name}
                                </span>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${cat.bg} ${cat.text} shrink-0`}>
                                  {item.category}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                Purchased: {item.purchase_date}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            {!item.is_consumed && (
                              <div className="text-right">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${badge.badgeClass}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${badge.dotClass}`} />
                                  <span>{badge.label}</span>
                                </span>
                                <span className="block text-[10px] text-slate-500 mt-0.5">{item.expiry_date}</span>
                              </div>
                            )}

                            {item.is_consumed && (
                              <span className="text-[11px] font-medium text-slate-500 bg-white/5 px-2.5 py-1 rounded-md">
                                Consumed
                              </span>
                            )}

                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleToggleConsumed(item.id, item.is_consumed)}
                                title={item.is_consumed ? "Mark as active" : "Mark consumed"}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                  item.is_consumed
                                    ? "bg-slate-800 text-slate-300 hover:bg-slate-700 border-white/10"
                                    : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border-emerald-500/30"
                                }`}
                              >
                                {item.is_consumed ? "↩ Undo" : "✅ Eat"}
                              </button>
                              <button
                                onClick={() => handleDelete(item.id)}
                                title="Delete item"
                                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}

              {/* ── Shopping Restock List ── */}
              {rightTab === "shopping" && (
                shoppingList.length === 0 ? (
                  <div className="py-24 px-4 text-center">
                    <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl">
                      🛍️
                    </div>
                    <p className="text-sm font-semibold text-slate-300">Restock list is clear!</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Items you finish or foods that expire automatically appear here so you remember to re-buy them.
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="px-6 py-3 bg-white/[0.02] border-b border-white/5 flex items-center justify-between text-xs text-slate-400">
                      <span>Restock suggestions based on consumed items:</span>
                      <span className="font-semibold text-emerald-400">{shoppingList.length} items to re-buy</span>
                    </div>
                    <div className="divide-y divide-white/5">
                      {shoppingList.map(item => {
                        const expired = getDaysLeft(item.expiry_date) < 0;
                        const cat = getCategoryStyle(item.category);

                        return (
                          <div key={item.id} className="p-4 sm:px-6 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors">
                            <div className="flex items-center gap-3">
                              <span className="text-lg">{cat.icon}</span>
                              <div>
                                <p className="text-sm font-semibold text-white">{item.name}</p>
                                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${cat.bg} ${cat.text}`}>
                                  {item.category}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <span className={`text-xs px-2.5 py-1 rounded-md font-medium border ${
                                expired 
                                  ? "bg-rose-500/15 text-rose-300 border-rose-500/30" 
                                  : "bg-slate-800 text-slate-400 border-white/10"
                              }`}>
                                {expired ? "Expired" : "Finished"}
                              </span>

                              <button
                                onClick={() => handleBuyAgain(item)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors shadow-sm"
                              >
                                <span>🔁</span>
                                <span>Bought Again</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )
              )}

            </div>
          </div>

        </div>
      </main>

      {/* ── India Phone & Automatic Notification Setup Modal ───────────────── */}
      {showNotificationModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel bg-[#0e1422] rounded-3xl border border-white/10 max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="text-xl">📱</span>
                <h3 className="font-bold text-base text-white">Automated Expiry Alerts (India & Global)</h3>
              </div>
              <button
                onClick={() => setShowNotificationModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Save your mobile number. FreshTrack will automatically check your inventory twice daily (morning & evening) and send urgent alerts for items expiring <strong>today or tomorrow</strong>.
            </p>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Mobile Number (India)</span>
                <span className="text-[10px] text-emerald-400 font-mono">10-digits</span>
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs font-semibold text-slate-400">🇮🇳 +91</span>
                <input
                  type="tel"
                  placeholder="9876543210"
                  value={phoneNumber.replace(/^\+91/, "")}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, "");
                    setPhoneNumber(val);
                    savePhoneSettings(val, autoNotify);
                  }}
                  className="w-full bg-slate-950/70 border border-white/10 rounded-xl pl-16 pr-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/60"
                />
              </div>
              <p className="text-[10px] text-slate-400">
                Indian numbers are automatically formatted to <code className="text-emerald-400">+91</code>.
              </p>
            </div>

            {/* Auto-Alert Schedule (Minimum 2 times per day) */}
            <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-white">Automated Expiry Scheduler (2x Daily)</p>
                  <p className="text-[10px] text-slate-400">Slot 1: Morning Check • Slot 2: Evening Check</p>
                </div>
                <input
                  type="checkbox"
                  checked={autoNotify}
                  onChange={e => savePhoneSettings(phoneNumber, e.target.checked)}
                  className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                />
              </div>

              <div className="text-[11px] text-amber-300/90 bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20">
                🎯 <strong>Trigger Rule:</strong> Automatically checks inventory twice daily and triggers alerts when items have <strong>≤ 1 day left</strong> (expires today or tomorrow).
              </div>

              {/* CallMeBot 100% Free Automated WhatsApp Bot Option */}
              <div className="pt-2 border-t border-white/5">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                    <span>⚡ Fully Automated WhatsApp Bot (CallMeBot)</span>
                  </label>
                  <a
                    href="https://api.whatsapp.com/send?phone=34644598487&text=I%20allow%20callmebot%20to%20send%20me%20messages"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-cyan-400 underline hover:text-cyan-300"
                  >
                    Get Free Key (1 min)
                  </a>
                </div>
                <input
                  type="text"
                  placeholder="Paste CallMeBot API Key here for 100% automatic WhatsApp"
                  value={callMeBotKey}
                  onChange={e => {
                    setCallMeBotKey(e.target.value.trim());
                    localStorage.setItem("freshtrack_cmb_key", e.target.value.trim());
                  }}
                  className="w-full bg-slate-950/70 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/60"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Once set, alerts are sent <strong>completely automatically in the background</strong> straight to your WhatsApp without opening any link!
                </p>
              </div>
            </div>

            {/* Alert Message Preview */}
            <div className="p-3 rounded-xl bg-slate-950/90 border border-white/5 text-xs text-slate-400">
              <span className="font-semibold text-slate-200 block mb-1">Alert Preview (Expiring by Tomorrow):</span>
              <p className="italic text-[11px] text-slate-300">
                {items.filter(i => !i.is_consumed && getDaysLeft(i.expiry_date) <= 1).length > 0
                  ? `⏰ FreshTrack Urgent: ${items.filter(i => !i.is_consumed && getDaysLeft(i.expiry_date) <= 1).map(i => `${i.name} (${getDaysLeft(i.expiry_date) === 0 ? "Today" : "Tomorrow"})`).join(", ")} expire within 24-48 hours!`
                  : "✅ FreshTrack: No groceries expiring by tomorrow."}
              </p>
            </div>

            {notifyStatus && (
              <div className={`p-3 rounded-xl text-xs font-medium border ${
                notifyStatus.type === "success" 
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" 
                  : "bg-rose-500/15 text-rose-300 border-rose-500/30"
              }`}>
                {notifyStatus.msg}
              </div>
            )}

            <div className="flex gap-2.5 pt-2">
              <button
                onClick={() => handleSendNotification("whatsapp")}
                disabled={sendingAlert || !phoneNumber.trim()}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold text-xs tracking-wide shadow-md shadow-emerald-500/10 transition-all flex items-center justify-center gap-2"
              >
                <span>💬</span>
                <span>Send WhatsApp Alert</span>
              </button>

              <button
                onClick={() => handleSendNotification("sms")}
                disabled={sendingAlert || !phoneNumber.trim()}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-semibold text-xs tracking-wide transition-all border border-white/10"
              >
                <span>✉️</span>
                <span>Send SMS</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── Reset Confirmation Modal ─────────────────────────────────────── */}
      {showReset && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel bg-[#0e1422] rounded-3xl border border-white/10 max-w-sm w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center text-2xl mx-auto border border-rose-500/30">
              ⚠️
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Reset Household Inventory?</h3>
              <p className="text-xs text-slate-400 mt-1">
                This will delete all <strong>{items.length} item(s)</strong> from your local database permanently.
              </p>
            </div>
            <div className="flex gap-2.5 pt-2">
              <button
                onClick={() => setShowReset(false)}
                className="flex-1 py-2 rounded-xl border border-white/10 text-slate-300 text-xs font-semibold hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-600/20"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Barcode Scanner Camera Modal ──────────────────────────────────── */}
      {showBarcode && (
        <BarcodeScanner
          onDetect={handleBarcodeDetect}
          onClose={() => setShowBarcode(false)}
        />
      )}

    </div>
  );
}
