"use strict";
// Copyright (c) 2023 Jose-Luis Landabaso - https://bitcoinerlab.com
// Distributed under the MIT software license
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.keyExpressionBIP32 = exports.keyExpressionLedger = exports.parseKeyExpression = void 0;
const bitcoinjs_lib_1 = require("bitcoinjs-lib");
const ledger_1 = require("./ledger");
const RE = __importStar(require("./re"));
const derivePath = (node, path) => {
    if (typeof path !== 'string') {
        throw new Error(`Error: invalid derivation path ${path}`);
    }
    const parsedPath = path.replaceAll('H', "'").replaceAll('h', "'").slice(1);
    const splitPath = parsedPath.split('/');
    for (const element of splitPath) {
        const unhardened = element.endsWith("'") ? element.slice(0, -1) : element;
        if (!Number.isInteger(Number(unhardened)) ||
            Number(unhardened) >= 0x80000000)
            throw new Error(`Error: BIP 32 path element overflow`);
    }
    return node.derivePath(parsedPath);
};
/**
 * Parses a key expression (xpub, xprv, pubkey or wif) into {@link KeyInfo | `KeyInfo`}.
 *
 * For example, given this `keyExpression`: `"[d34db33f/49'/0'/0']tpubDCdxmvzJ5QBjTN8oCjjyT2V58AyZvA1fkmCeZRC75QMoaHcVP2m45Bv3hmnR7ttAwkb2UNYyoXdHVt4gwBqRrJqLUU2JrM43HippxiWpHra/1/2/3/4/*"`, this is its parsed result:
 *
 * ```javascript
 *  {
 *    keyExpression:
 *      "[d34db33f/49'/0'/0']tpubDCdxmvzJ5QBjTN8oCjjyT2V58AyZvA1fkmCeZRC75QMoaHcVP2m45Bv3hmnR7ttAwkb2UNYyoXdHVt4gwBqRrJqLUU2JrM43HippxiWpHra/1/2/3/4/*",
 *    keyPath: '/1/2/3/4/*',
 *    originPath: "/49'/0'/0'",
 *    path: "m/49'/0'/0'/1/2/3/4/*",
 *    // Other relevant properties of the type `KeyInfo`: `pubkey`, `ecpair` & `bip32` interfaces, `masterFingerprint`, etc.
 *  }
 * ```
 */
function parseKeyExpression({ keyExpression, isSegwit, ECPair, BIP32, network = bitcoinjs_lib_1.networks.bitcoin }) {
    let pubkey; //won't be computed for ranged keyExpressions
    let ecpair;
    let bip32;
    let masterFingerprint;
    let originPath;
    let keyPath;
    let path;
    const isRanged = keyExpression.indexOf('*') !== -1;
    //Validate the keyExpression:
    const keyExpressions = keyExpression.match(RE.reKeyExp);
    if (keyExpressions === null || keyExpressions[0] !== keyExpression) {
        throw new Error(`Error: expected a keyExpression but got ${keyExpression}`);
    }
    const reOriginAnchoredStart = RegExp(String.raw `^(${RE.reOrigin})?`); //starts with ^origin
    const mOrigin = keyExpression.match(reOriginAnchoredStart);
    if (mOrigin) {
        const bareOrigin = mOrigin[0].replace(/[[\]]/g, ''); //strip the "[" and "]" in [origin]
        const reMasterFingerprintAnchoredStart = String.raw `^(${RE.reMasterFingerprint})`;
        const mMasterFingerprint = bareOrigin.match(reMasterFingerprintAnchoredStart);
        const masterFingerprintHex = mMasterFingerprint
            ? mMasterFingerprint[0]
            : '';
        originPath = bareOrigin.replace(masterFingerprintHex, '');
        if (masterFingerprintHex.length > 0) {
            if (masterFingerprintHex.length !== 8)
                throw new Error(`Error: masterFingerprint ${masterFingerprintHex} invalid for keyExpression: ${keyExpression}`);
            masterFingerprint = Buffer.from(masterFingerprintHex, 'hex');
        }
    }
    //Remove the origin (if it exists) and store result in actualKey
    const actualKey = keyExpression.replace(reOriginAnchoredStart, '');
    let mPubKey, mWIF, mXpubKey, mXprvKey;
    //match pubkey:
    if ((mPubKey = actualKey.match(RE.anchorStartAndEnd(RE.rePubKey))) !== null) {
        pubkey = Buffer.from(mPubKey[0], 'hex');
        ecpair = ECPair.fromPublicKey(pubkey, { network });
        //Validate the pubkey (compressed or uncompressed)
        if (!ECPair.isPoint(pubkey) ||
            !(pubkey.length === 33 || pubkey.length === 65)) {
            throw new Error(`Error: invalid pubkey`);
        }
        //Do an extra check in case we know this pubkey refers to a segwit input
        if (typeof isSegwit === 'boolean' &&
            isSegwit &&
            pubkey.length !== 33 //Inside wpkh and wsh, only compressed public keys are permitted.
        ) {
            throw new Error(`Error: invalid pubkey`);
        }
        //match WIF:
    }
    else if ((mWIF = actualKey.match(RE.anchorStartAndEnd(RE.reWIF))) !== null) {
        ecpair = ECPair.fromWIF(mWIF[0], network);
        //fromWIF will throw if the wif is not valid
        pubkey = ecpair.publicKey;
        //match xpub:
    }
    else if ((mXpubKey = actualKey.match(RE.anchorStartAndEnd(RE.reXpubKey))) !== null) {
        const xPubKey = mXpubKey[0];
        const xPub = xPubKey.match(RE.reXpub)?.[0];
        if (!xPub)
            throw new Error(`Error: xpub could not be matched`);
        bip32 = BIP32.fromBase58(xPub, network);
        const mPath = xPubKey.match(RE.rePath);
        if (mPath !== null) {
            keyPath = xPubKey.match(RE.rePath)?.[0];
            if (!keyPath)
                throw new Error(`Error: could not extract a path`);
            //fromBase58 and derivePath will throw if xPub or path are not valid
            if (!isRanged)
                pubkey = derivePath(bip32, keyPath).publicKey;
        }
        else {
            pubkey = bip32.publicKey;
        }
        //match xprv:
    }
    else if ((mXprvKey = actualKey.match(RE.anchorStartAndEnd(RE.reXprvKey))) !== null) {
        const xPrvKey = mXprvKey[0];
        const xPrv = xPrvKey.match(RE.reXprv)?.[0];
        if (!xPrv)
            throw new Error(`Error: xprv could not be matched`);
        bip32 = BIP32.fromBase58(xPrv, network);
        const mPath = xPrvKey.match(RE.rePath);
        if (mPath !== null) {
            keyPath = xPrvKey.match(RE.rePath)?.[0];
            if (!keyPath)
                throw new Error(`Error: could not extract a path`);
            //fromBase58 and derivePath will throw if xPrv or path are not valid
            if (!isRanged)
                pubkey = derivePath(bip32, keyPath).publicKey;
        }
        else {
            pubkey = bip32.publicKey;
        }
    }
    else {
        throw new Error(`Error: could not get pubkey for keyExpression ${keyExpression}`);
    }
    if (originPath || keyPath) {
        path = `m${originPath ?? ''}${keyPath ?? ''}`;
    }
    return {
        keyExpression,
        ...(pubkey !== undefined ? { pubkey } : {}),
        ...(ecpair !== undefined ? { ecpair } : {}),
        ...(bip32 !== undefined ? { bip32 } : {}),
        ...(masterFingerprint !== undefined ? { masterFingerprint } : {}),
        ...(originPath !== undefined && originPath !== '' ? { originPath } : {}),
        ...(keyPath !== undefined && keyPath !== '' ? { keyPath } : {}),
        ...(path !== undefined ? { path } : {})
    };
}
exports.parseKeyExpression = parseKeyExpression;
function assertChangeIndexKeyPath({ change, index, keyPath }) {
    if (!((change === undefined && index === undefined) ||
        (change !== undefined && index !== undefined)))
        throw new Error(`Error: Pass change and index or neither`);
    if ((change !== undefined) === (keyPath !== undefined))
        throw new Error(`Error: Pass either change and index or a keyPath`);
}
/** @hidden */
async function keyExpressionLedger({ ledgerClient, ledgerState, ledgerManager, originPath, keyPath, change, index }) {
    if (ledgerManager && (ledgerClient || ledgerState))
        throw new Error(`ledgerClient and ledgerState have been deprecated`);
    if (ledgerManager)
        ({ ledgerClient, ledgerState } = ledgerManager);
    if (!ledgerClient || !ledgerState)
        throw new Error(`Could not retrieve ledgerClient or ledgerState`);
    assertChangeIndexKeyPath({ change, index, keyPath });
    const masterFingerprint = await (0, ledger_1.getLedgerMasterFingerPrint)({
        ledgerClient,
        ledgerState
    });
    const origin = `[${masterFingerprint.toString('hex')}${originPath}]`;
    const xpub = await (0, ledger_1.getLedgerXpub)({ originPath, ledgerClient, ledgerState });
    const keyRoot = `${origin}${xpub}`;
    if (keyPath !== undefined)
        return `${keyRoot}${keyPath}`;
    else
        return `${keyRoot}/${change}/${index}`;
}
exports.keyExpressionLedger = keyExpressionLedger;
/**
 * Constructs a key expression string from its constituent components.
 *
 * This function essentially performs the reverse operation of
 * {@link _Internal_.ParseKeyExpression | ParseKeyExpression}. For detailed
 * explanations and examples of the terms used here, refer to
 * {@link _Internal_.ParseKeyExpression | ParseKeyExpression}.
 */
function keyExpressionBIP32({ masterNode, originPath, keyPath, change, index, isPublic = true }) {
    assertChangeIndexKeyPath({ change, index, keyPath });
    const masterFingerprint = masterNode.fingerprint;
    const origin = `[${masterFingerprint.toString('hex')}${originPath}]`;
    const xpub = isPublic
        ? masterNode.derivePath(`m${originPath}`).neutered().toBase58().toString()
        : masterNode.derivePath(`m${originPath}`).toBase58().toString();
    const keyRoot = `${origin}${xpub}`;
    if (keyPath !== undefined)
        return `${keyRoot}${keyPath}`;
    else
        return `${keyRoot}/${change}/${index}`;
}
exports.keyExpressionBIP32 = keyExpressionBIP32;
