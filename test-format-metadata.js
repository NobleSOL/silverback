// Test what formatMetadata produces
import Resolver from '@keetanetwork/anchor/lib/resolver.js';

const testMetadata = {
  version: 1,
  currencyMap: {
    "$KTA": "keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52",
    "$WAVE": "keeta_ant6bsl2obpmreopln5e242s3ihxyzjepd6vbkeoz3b3o3pxjtlsx3saixkym"
  },
  services: {
    fx: {
      silverback: {
        operations: {
          getEstimate: "https://dexkeeta.onrender.com/fx/api/getEstimate",
          getQuote: "https://dexkeeta.onrender.com/fx/api/getQuote",
          createExchange: "https://dexkeeta.onrender.com/fx/api/createExchange",
          getExchangeStatus: "https://dexkeeta.onrender.com/fx/api/getExchangeStatus/{id}"
        },
        from: [
          { currencyCodes: ["keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52"], to: ["keeta_ant6bsl2obpmreopln5e242s3ihxyzjepd6vbkeoz3b3o3pxjtlsx3saixkym"] },
          { currencyCodes: ["keeta_ant6bsl2obpmreopln5e242s3ihxyzjepd6vbkeoz3b3o3pxjtlsx3saixkym"], to: ["keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52"] }
        ]
      }
    }
  }
};

console.log('Input metadata:');
console.log(JSON.stringify(testMetadata, null, 2));
console.log('');

const formatted = Resolver.Metadata.formatMetadata(testMetadata);
console.log('Formatted output:');
console.log('Type:', typeof formatted);
console.log('Length:', formatted.length, 'bytes');
console.log('Preview:', formatted.substring(0, 100));
console.log('');
console.log('Full output:');
console.log(formatted);
