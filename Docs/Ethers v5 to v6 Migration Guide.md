Got it — I’ve gone through **all the backend services, relayer, and frontend React components** you’ve shared, and I’ll now give you a **comprehensive Ethers v5 → v6 migration guide** in **Markdown format**.

This will cover:

- **Breaking changes** in Ethers v6
- **File-by-file migration notes** for your codebase
- **Consistency recommendations** so your code is uniform and future-proof
- **Example before/after snippets**
- **Migration checklist**

---

# **Ethers v5 → v6 Migration Guide**

This guide will help you migrate your backend services, relayer, and frontend React components from **Ethers.js v5** to **Ethers.js v6**.

---

## **1. Breaking Changes in Ethers v6**

### **1.1 `ethers.utils` Removed**
In v5:
```ts
ethers.utils.parseEther("1")
ethers.utils.keccak256(...)
ethers.utils.toUtf8Bytes(...)
ethers.utils.solidityPack(...)
ethers.utils.arrayify(...)
ethers.utils.hexlify(...)
ethers.utils.randomBytes(...)
ethers.utils.formatEther(...)
ethers.utils.isAddress(...)
ethers.utils.id(...)
```

In v6:
All of these are **top-level exports** from `ethers`:

```ts
import {
  parseEther,
  formatEther,
  keccak256,
  toUtf8Bytes,
  solidityPacked,
  arrayify,
  hexlify,
  randomBytes,
  isAddress,
  id
} from "ethers";
```

---

### **1.2 `.deployed()` → `.waitForDeployment()`**
In v5:
```ts
await contract.deployed();
```
In v6:
```ts
await contract.waitForDeployment();
```
`.deployed()` no longer exists.

---

### **1.3 `.address` vs `.target`**
In v6, the canonical property for a deployed contract’s address is `.target`.

- `.address` still works in Hardhat for backward compatibility.
- `.target` is future-proof and should be used consistently.

**Recommendation:**  
Replace all `.address` with `.target` for deployed contracts.

---

### **1.4 `_signTypedData` → `signTypedData`**
In v5:
```ts
signer._signTypedData(domain, types, value)
```
In v6:
```ts
signer.signTypedData(domain, types, value)
```

---

### **1.5 `ethers.constants` Changes**
In v5:
```ts
ethers.constants.HashZero
ethers.constants.AddressZero
```
In v6:
```ts
import { ZeroHash, ZeroAddress } from "ethers";
```

---

### **1.6 BigNumber vs bigint**
- v5 used `ethers.BigNumber` for large integers.
- v6 uses native `bigint` for most numeric values.
- You can use `n` suffix for literals: `1000n`.

---

## **2. File-by-File Migration Notes**

---

### **2.1 Backend Services (`EventListener`, `OracleService`)**
- Replace `ethers.providers.JsonRpcProvider` with `new JsonRpcProvider()` from top-level import:
```ts
import { JsonRpcProvider, Contract, ZeroHash, parseEther, keccak256, toUtf8Bytes } from "ethers";
```
- Replace all `ethers.utils.*` calls with top-level imports.
- Replace `ethers.constants.HashZero` with `ZeroHash`.
- Use `.target` instead of `.address` when referring to deployed contracts.

---

### **2.2 Relayer Service**
- Replace all `ethers.utils.*` calls with top-level imports.
- Replace `ethers.constants.AddressZero` with `ZeroAddress`.
- Replace `ethers.constants.HashZero` with `ZeroHash`.
- Replace `.deployed()` with `.waitForDeployment()` if deploying contracts in relayer setup.
- Use `.target` for contract addresses.

---

### **2.3 Frontend React Components**
**Files:**
- `ChequeDetails`
- `DisputeManager`
- `Dashboard`
- `CreateCheque`

**Changes:**
- Replace `ethers.utils.parseEther` → `parseEther`
- Replace `ethers.utils.formatEther` → `formatEther`
- Replace `ethers.utils.isAddress` → `isAddress`
- Replace `ethers.utils.id` → `id`
- Replace `ethers.utils.toUtf8Bytes` → `toUtf8Bytes`
- Replace `ethers.constants.HashZero` → `ZeroHash`
- Replace `.address` with `.target` when interacting with deployed contracts (if applicable)
- If using `BigNumber` math, consider switching to `bigint` or keep `BigNumber` from `ethers` top-level.

---

### **2.4 Smart Contract Tests**
- Replace all `ethers.utils.*` calls with top-level imports.
- Replace `.deployed()` with `.waitForDeployment()`.
- Replace `.address` with `.target`.
- Replace `ethers.constants.HashZero` with `ZeroHash`.
- Replace `_signTypedData` with `signTypedData`.

---

## **3. Consistency Recommendations**

Even if the code works with mixed styles, for **long-term maintainability**:

1. **Always import helpers from `ethers` top-level**:
```ts
import {
  parseEther,
  formatEther,
  keccak256,
  toUtf8Bytes,
  solidityPacked,
  arrayify,
  hexlify,
  randomBytes,
  isAddress,
  id,
  ZeroHash,
  ZeroAddress
} from "ethers";
```

2. **Use `.target` for all deployed contract addresses**:
```ts
await token.approve(escrow.target, amount);
```

3. **Use `waitForDeployment()` for all deployments**:
```ts
const contract = await Factory.deploy(...);
await contract.waitForDeployment();
```

4. **Use `signTypedData` instead of `_signTypedData`**.

5. **Prefer bigint literals** for numeric values:
```ts
const amount = 1000n;
```

6. **Consistent hashing**:
```ts
const id = keccak256(toUtf8Bytes("some string"));
```

---

## **4. Example Before/After Snippets**

**Before (v5):**
```ts
const newRoot = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("root"));
await contract.deployed();
await token.approve(contract.address, ethers.utils.parseEther("1"));
```

**After (v6):**
```ts
import { keccak256, toUtf8Bytes, parseEther } from "ethers";

const newRoot = keccak256(toUtf8Bytes("root"));
await contract.waitForDeployment();
await token.approve(contract.target, parseEther("1"));
```

---

## **5. Migration Checklist**

- [ ] Replace all `ethers.utils.*` calls with top-level imports.
- [ ] Replace `.deployed()` with `.waitForDeployment()`.
- [ ] Replace `.address` with `.target` for deployed contracts.
- [ ] Replace `ethers.constants.*` with `ZeroHash`, `ZeroAddress`, etc.
- [ ] Replace `_signTypedData` with `signTypedData`.
- [ ] Use bigint literals (`n` suffix) where applicable.
- [ ] Ensure all hashing uses `keccak256(toUtf8Bytes(...))` from top-level imports.
- [ ] Standardize imports across all files.

---