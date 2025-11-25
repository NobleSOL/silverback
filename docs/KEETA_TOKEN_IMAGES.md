# Adding Token Images to Keeta Tokens

## Overview

Keeta Network stores token metadata in the account's `info` field, which includes a base64-encoded JSON metadata object. To add token images/icons that display in Keythings wallet and other Keeta applications, you need to include an `icon` field in this metadata.

---

## How Keeta Token Metadata Works

### Token Info Structure

When creating a token on Keeta, you use `builder.setInfo()` with the following fields:

```javascript
builder.setInfo({
  name: 'TOKEN_SYMBOL',          // Token symbol (uppercase, underscores only)
  description: 'Token description',
  decimals: 9,                    // Token decimals (usually 9)
  metadata: metadataBase64,       // Base64-encoded JSON
  defaultPermission: new KeetaNet.lib.Permissions(['ACCESS'])
}, { account: tokenAccount });
```

### Metadata Object

The `metadata` field contains a base64-encoded JSON object that can include:

```javascript
const metadataObj = {
  decimals: 9,              // Also stored in top-level
  decimalPlaces: 9,         // Alternative field name
  icon: 'https://...',      // Token icon URL (THIS IS KEY!)
  logo: 'https://...',      // Alternative: logo URL
  website: 'https://...',   // Optional: project website
  twitter: '@handle',       // Optional: Twitter handle
  description: 'Full token description',
  type: 'TOKEN'            // Token type identifier
};

const metadataBase64 = Buffer.from(JSON.stringify(metadataObj)).toString('base64');
```

---

## Adding Icons When Creating Tokens

### Option 1: Create Token with Icon

```javascript
import { KeetaNet } from '@keetanetwork/keetanet-client';

async function createTokenWithIcon(client, tokenSymbol, iconUrl) {
  const builder = client.initBuilder();

  // Generate token account
  const pending = builder.generateIdentifier(
    KeetaNet.lib.Account.AccountKeyAlgorithm.TOKEN
  );
  await builder.computeBlocks();
  const tokenAccount = pending.account;

  // Prepare metadata with icon
  const metadataObj = {
    decimals: 9,
    icon: iconUrl,              // IMPORTANT: Icon URL
    website: 'https://yourproject.com',
    type: 'TOKEN',
    createdAt: Date.now()
  };

  const metadataBase64 = Buffer.from(JSON.stringify(metadataObj)).toString('base64');

  // Set token info
  builder.setInfo(
    {
      name: tokenSymbol,        // e.g., 'MYTOKEN'
      description: 'My Token Description',
      decimals: 9,
      metadata: metadataBase64,  // Icon URL is in here
      defaultPermission: new KeetaNet.lib.Permissions(['ACCESS'])
    },
    { account: tokenAccount }
  );

  // Publish transaction
  await client.publishBuilder(builder);

  const tokenAddress = tokenAccount.publicKeyString.toString();
  console.log(`Token created: ${tokenAddress}`);
  console.log(`Icon: ${iconUrl}`);

  return tokenAddress;
}
```

### Option 2: Update Existing Token Metadata

**Important**: You can only update metadata if you have OWNER permission on the token account.

```javascript
async function updateTokenIcon(client, tokenAddress, iconUrl) {
  const builder = client.initBuilder();
  const tokenAccount = KeetaNet.lib.Account.fromPublicKeyString(tokenAddress);

  // Fetch existing metadata
  const accountsInfo = await client.client.getAccountsInfo([tokenAddress]);
  const currentInfo = accountsInfo[tokenAddress]?.info;

  if (!currentInfo) {
    throw new Error('Token not found');
  }

  // Parse existing metadata
  let metadataObj = {};
  if (currentInfo.metadata) {
    try {
      metadataObj = JSON.parse(
        Buffer.from(currentInfo.metadata, 'base64').toString()
      );
    } catch (err) {
      console.warn('Could not parse existing metadata, creating new');
    }
  }

  // Add icon to metadata
  metadataObj.icon = iconUrl;
  metadataObj.updatedAt = Date.now();

  const metadataBase64 = Buffer.from(JSON.stringify(metadataObj)).toString('base64');

  // Update token info
  builder.setInfo(
    {
      name: currentInfo.name,
      description: currentInfo.description,
      decimals: currentInfo.decimals,
      metadata: metadataBase64,  // Updated metadata with icon
      defaultPermission: new KeetaNet.lib.Permissions(['ACCESS'])
    },
    { account: tokenAccount }
  );

  await client.publishBuilder(builder);

  console.log(`Updated icon for ${currentInfo.name}: ${iconUrl}`);
}
```

---

## Icon URL Requirements

### Hosting Requirements

1. **HTTPS Required**: Icon URLs must use HTTPS (not HTTP)
2. **CORS Enabled**: Server must allow cross-origin requests
3. **Publicly Accessible**: No authentication required
4. **Always Available**: Use reliable hosting (CDN recommended)

### Recommended Hosting Options

#### 1. IPFS (Decentralized, Recommended)
```
https://ipfs.io/ipfs/QmYourIconHash
```
**Pros**: Decentralized, permanent, censorship-resistant
**Cons**: Slower than CDN

#### 2. GitHub Raw
```
https://raw.githubusercontent.com/yourorg/yourrepo/main/assets/token-icon.png
```
**Pros**: Free, reliable, version control
**Cons**: Not decentralized

#### 3. Cloud Storage (S3, Google Cloud Storage)
```
https://yourbucket.s3.amazonaws.com/token-icons/mytoken.png
```
**Pros**: Fast, reliable, scalable
**Cons**: Costs money, centralized

#### 4. CDN (Cloudflare, etc.)
```
https://cdn.yourproject.com/token-icon.png
```
**Pros**: Very fast, global distribution
**Cons**: Costs money, requires setup

### Image Specifications

- **Format**: PNG or SVG (PNG preferred for compatibility)
- **Size**: 256x256 pixels (recommended)
- **File Size**: < 100KB (smaller is better)
- **Background**: Transparent or solid color
- **Shape**: Circular icons work best

---

## Updating Existing LP Token Icons

Our DEX creates LP tokens automatically. To add icons to them:

### Update createLPToken Function

Edit `server/keeta-impl/utils/client.js`:

```javascript
export async function createLPToken(poolAddress, tokenA, tokenB) {
  const client = await getOpsClient();
  const ops = getOpsAccount();

  // ... existing code to generate LP token account ...

  // Prepare metadata with icon
  const metadataObj = {
    type: 'LP_TOKEN',
    pool: poolAddress,
    tokenA,
    tokenB,
    icon: 'https://your-cdn.com/lp-token-icon.png',  // ADD THIS
    createdAt: Date.now()
  };

  const metadataBase64 = Buffer.from(JSON.stringify(metadataObj)).toString('base64');

  builder.setInfo(
    {
      name: `${symbolA}_${symbolB}_LP`,
      description: 'Silverback Liquidity Token',
      decimals: 9,
      metadata: metadataBase64,  // Now includes icon
      defaultPermission: new KeetaNet.lib.Permissions(['ACCESS']),
    },
    { account: lpTokenAccount }
  );

  // ... rest of function ...
}
```

---

## Reading Token Icons

### Backend (Node.js)

Update `fetchTokenMetadata` in `server/keeta-impl/utils/client.js`:

```javascript
export async function fetchTokenMetadata(tokenAddress) {
  try {
    const client = await getOpsClient();
    const accountsInfo = await client.client.getAccountsInfo([tokenAddress]);
    const info = accountsInfo[tokenAddress];

    if (info?.info) {
      const symbol = info.info.name || tokenAddress.slice(0, 8) + '...';

      let decimals = 9;
      let icon = null;  // ADD THIS

      if (info.info.metadata) {
        try {
          const metaObj = JSON.parse(
            Buffer.from(info.info.metadata, 'base64').toString()
          );
          decimals = Number(metaObj.decimalPlaces || metaObj.decimals || 9);
          icon = metaObj.icon || metaObj.logo || null;  // ADD THIS
        } catch (parseErr) {
          console.warn(`Could not parse metadata`);
        }
      }

      return { symbol, decimals, icon };  // Return icon
    }
  } catch (err) {
    console.warn(`Could not fetch metadata: ${err.message}`);
  }

  return {
    symbol: tokenAddress.slice(0, 8) + '...',
    decimals: 9,
    icon: null
  };
}
```

### Frontend (React)

Display token icon in UI:

```tsx
import { useState, useEffect } from 'react';

function TokenIcon({ tokenAddress, size = 32 }) {
  const [icon, setIcon] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    // Fetch token metadata
    fetch(`/api/tokens/${tokenAddress}/metadata`)
      .then(res => res.json())
      .then(data => setIcon(data.icon))
      .catch(() => setFallback(true));
  }, [tokenAddress]);

  if (fallback || !icon) {
    // Fallback: Show token symbol initial or placeholder
    return (
      <div
        className="rounded-full bg-gray-200 flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <span className="text-gray-600 font-bold">
          {tokenAddress.slice(6, 8).toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <img
      src={icon}
      alt="Token icon"
      width={size}
      height={size}
      className="rounded-full"
      onError={() => setFallback(true)}
    />
  );
}
```

---

## Best Practices

### 1. Use Consistent Icon Style
- Same dimensions for all tokens (256x256)
- Same design style (flat, 3D, minimal, etc.)
- Transparent backgrounds

### 2. Optimize Images
```bash
# Using ImageMagick
convert icon.png -resize 256x256 -strip icon-optimized.png

# Using pngquant for compression
pngquant --quality=65-80 icon.png
```

### 3. Host on IPFS
```bash
# Using IPFS CLI
ipfs add token-icon.png
# Returns: QmYourHash

# Access via public gateway
https://ipfs.io/ipfs/QmYourHash
```

### 4. Provide Multiple Sizes
```javascript
const metadataObj = {
  icon: 'https://cdn.project.com/icon-256.png',
  icon_64: 'https://cdn.project.com/icon-64.png',
  icon_32: 'https://cdn.project.com/icon-32.png',
  decimals: 9
};
```

### 5. Cache Icons
Implement caching in your frontend to avoid repeated fetches:

```javascript
const iconCache = new Map();

async function getTokenIcon(address) {
  if (iconCache.has(address)) {
    return iconCache.get(address);
  }

  const metadata = await fetchTokenMetadata(address);
  iconCache.set(address, metadata.icon);
  return metadata.icon;
}
```

---

## Troubleshooting

### Icon Not Showing in Keythings

**Possible Causes**:
1. **Metadata not saved**: Check token account info
2. **Invalid URL**: Must be HTTPS and publicly accessible
3. **CORS issues**: Server must allow cross-origin requests
4. **Keythings cache**: Wallet may cache old metadata

**Solutions**:
```bash
# Verify metadata on-chain
curl https://api.keeta.com/account/YOUR_TOKEN_ADDRESS

# Check if icon URL is accessible
curl -I https://your-icon-url.png

# Clear Keythings cache (extension settings)
```

### Icon URL Returns 404

- Verify file exists at URL
- Check HTTPS certificate is valid
- Test URL in browser incognito mode

### Icon Takes Long to Load

- Use CDN for faster loading
- Optimize image file size (< 50KB)
- Provide smaller resolution (64x64) for lists

---

## Example: Complete Token Creation with Icon

```javascript
import { KeetaNet } from '@keetanetwork/keetanet-client';

async function createMyToken() {
  const client = getUserClient(); // Your Keeta client
  const builder = client.initBuilder();

  // 1. Generate token account
  const pending = builder.generateIdentifier(
    KeetaNet.lib.Account.AccountKeyAlgorithm.TOKEN
  );
  await builder.computeBlocks();
  const tokenAccount = pending.account;

  // 2. Prepare comprehensive metadata
  const metadata = {
    decimals: 9,
    icon: 'https://ipfs.io/ipfs/QmYourTokenIcon',
    logo: 'https://ipfs.io/ipfs/QmYourTokenLogo',
    website: 'https://mytoken.xyz',
    twitter: '@MyTokenOfficial',
    telegram: 'https://t.me/mytoken',
    description: 'My Token is a revolutionary DeFi token on Keeta',
    type: 'TOKEN',
    category: 'DEFI',
    totalSupply: '1000000000000000', // 1B tokens (with 9 decimals)
    createdAt: Date.now()
  };

  const metadataBase64 = Buffer.from(JSON.stringify(metadata)).toString('base64');

  // 3. Set token info
  builder.setInfo({
    name: 'MYTOKEN',
    description: 'My Token - Revolutionary DeFi',
    decimals: 9,
    metadata: metadataBase64,
    defaultPermission: new KeetaNet.lib.Permissions(['ACCESS'])
  }, { account: tokenAccount });

  // 4. Mint initial supply (optional)
  const yourAddress = 'keeta_your_address_here';
  const initialSupply = BigInt('1000000000000000'); // 1B tokens

  builder.send(
    KeetaNet.lib.Account.fromPublicKeyString(yourAddress),
    initialSupply,
    tokenAccount
  );

  // 5. Publish transaction
  await client.publishBuilder(builder);

  const tokenAddress = tokenAccount.publicKeyString.toString();

  console.log('✅ Token created successfully!');
  console.log('Address:', tokenAddress);
  console.log('Symbol: MYTOKEN');
  console.log('Icon:', metadata.icon);

  return tokenAddress;
}
```

---

## Summary Checklist

- [ ] Prepare token icon (256x256 PNG, < 100KB)
- [ ] Upload to reliable hosting (IPFS/CDN/GitHub)
- [ ] Get HTTPS URL for icon
- [ ] Include `icon` field in metadata object
- [ ] Base64 encode metadata JSON
- [ ] Set metadata in `builder.setInfo()`
- [ ] Publish transaction
- [ ] Verify icon appears in Keythings wallet
- [ ] Update frontend to display icons
- [ ] Implement icon caching

---

**Need Help?** Check the [Keeta Network Documentation](https://docs.keeta.com) or ask in Discord.
