-- One Apple subject may belong to only one Negroni user.
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account"("providerId", "accountId");
