#!/bin/bash
# Load environment variables and run FX resolver publisher

cd /home/taylo/silverback-clean
export NODE_ENV=production
node server/keeta-impl/services/publish-fx-resolver.js publish
