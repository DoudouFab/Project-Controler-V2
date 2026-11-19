# Spécification de sécurité Firestore — ProjectController INASEP

## 1. Invariants de données et d'accès

1. **Administrateur unique vérifié** : Seul le compte authentifié avec `request.auth.token.email_verified == true` et `request.auth.token.email.lower() == "pirquinfabien@gmail.com"` possède les privilèges d'administration (`isAdmin()`).
2. **Isolation stricte et refus par défaut** : Toute collection non explicitement autorisée est refusée (`match /{document=**} { allow read, write: if false; }`).
3. **Zéro liste publique / zéro fuite PII** : Un non-admin ne peut jamais exécuter `list` sur `preauthorized_emails` ou `access_users`. Il ne peut lire (`get`) que sa propre fiche `access_users/{request.auth.uid}` et le document `preauthorized_emails/{emailId}` correspondant exactement à son propre e-mail vérifié.
4. **Activation vérifiée côté serveur** : Un utilisateur non-admin ne peut s'auto-attribuer `status: "approved"` (à la création ou lors d'un passage `pending -> approved`) que si `preauthorized_emails/{emailId}` existe et que `activationCode` correspond (insensible à la casse) au `accessCode` enregistré par l'administrateur.
5. **Anti-élévation de privilèges** : Un non-admin ne peut jamais définir `role: "admin"`, modifier son `uid`, son `email`, son `createdAt`, ni quitter l'état terminal `revoked`.
6. **Contraintes strictes de schéma et anti-DoW** : Clés exactes (`hasAll` + `hasOnly`), bornes `.size()` sur toutes les chaînes, validation d'identifiant (`isValidId`), horodatages serveur obligatoires (`request.time`).

## 2. Les « Dirty Dozen » — 12 charges d'attaque devant retourner `PERMISSION_DENIED`

1. **Admin spoofé sans vérification d'e-mail** : Lecture/écriture sur `preauthorized_emails` avec `email = "pirquinfabien@gmail.com"` et `email_verified = false`.
2. **Auto-élévation admin** : Création de `access_users/{uid}` par un collègue avec `role: "admin"`.
3. **Auto-approbation sans préautorisation** : Création de `access_users/{uid}` avec `status: "approved"` alors qu'aucun document `preauthorized_emails/{emailId}` n'existe.
4. **Auto-approbation avec mauvais code personnel** : Création/mise à jour de `access_users/{uid}` vers `status: "approved"` avec un `activationCode` erroné.
5. **Contournement de révocation** : Mise à jour par l'utilisateur de son propre `access_users/{uid}` depuis `status: "revoked"` vers `status: "approved"` ou `"pending"`.
6. **Usurpation de `uid` ou `email`** : Création de `access_users/{uid}` avec `data.uid != request.auth.uid` ou `data.email != request.auth.token.email.lower()`.
7. **Champ fantôme (Shadow Update)** : Écriture d'un champ non autorisé (ex. `isAdmin: true`, `bypass: true`) sur `access_users` ou `preauthorized_emails`.
8. **Empoisonnement d'horodatage** : Envoi d'un timestamp client falsifié au lieu de `serverTimestamp()` (`request.time`) pour `createdAt` ou `updatedAt`.
9. **Mutation d'un champ immuable** : Modification de `createdAt`, `uid`, `email` ou `role` lors d'un `update` utilisateur sur `access_users/{uid}`.
10. **Lecture PII d'un autre collègue** : `get` sur `access_users/{otherUid}` ou `preauthorized_emails/{otherEmailId}` par un utilisateur non-admin.
11. **Énumération de collection (`list`)** : Requête `getDocs` sur `access_users` ou `preauthorized_emails` par un utilisateur non-admin.
12. **Dépassement de taille (Denial of Wallet)** : Chaîne de 5 000 caractères injectée dans `displayName`, `note` ou `deviceHint`, ou ID document invalide (> 128 caractères ou caractères interdits).
