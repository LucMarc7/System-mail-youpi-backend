#!/bin/bash
echo "🧪 Démarrage des tests du backend Youpi Mail..."
echo "=============================================="

BASE_URL="http://localhost:3001"

# Test 1: Santé
echo -e "\n1. Testing health endpoint..."
curl -s "$BASE_URL/api/health" | jq '.status' 2>/dev/null || curl -s "$BASE_URL/api/health"

# Test 2: Auth Google
echo -e "\n2. Testing Google auth..."
AUTH_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/google" \
  -H "Content-Type: application/json" \
  -d '{"token": "test-token"}')
echo $AUTH_RESPONSE | jq '.success' 2>/dev/null || echo $AUTH_RESPONSE

# Test 3: Templates
echo -e "\n3. Testing template previews..."
for template in marketing partner ad other; do
  echo -n "  $template: "
  curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/templates/preview?destinator=$template"
  echo " OK"
done

# Test 4: Email sending
echo -e "\n4. Testing email sending..."
EMAIL_RESPONSE=$(curl -s -X POST "$BASE_URL/api/emails/send" \
  -H "Content-Type: application/json" \
  -d '{"to": "test@example.com", "subject": "Test", "message": "Test", "destinator": "marketing"}')
echo $EMAIL_RESPONSE | jq '.success' 2>/dev/null || echo $EMAIL_RESPONSE

echo -e "\n✅ Tests terminés! Vérifiez les logs du serveur pour les détails."