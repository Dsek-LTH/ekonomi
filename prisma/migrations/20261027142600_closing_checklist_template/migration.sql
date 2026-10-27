-- The checklist a bokslut starts from.
--
-- A first draft, written to be edited: it is a row per step, and the
-- skattmästare keeps it under Bokslut -> Mall. In its own migration because the
-- ClosingCheck and Role values it names were created in the previous one, and
-- because a deployment has to get it too. A seed would only reach a database
-- somebody reset.
--
-- Due dates are days from the last day of the financial year, negative before.
INSERT INTO "ChecklistTemplateItem" ("id", "title", "howTo", "ownerRole", "dueOffsetDays", "check", "sortOrder", "active", "updatedAt")
VALUES
  ('tpl_remind', 'Påminn om utlägg före årsskiftet',
   'Skicka en påminnelse till alla som har utkast eller kortköp utan utlägg, så att det kommer in på rätt år. Påminnelser skickas från listan över utlägg och från Bankhändelser.',
   'SKATTMASTARE', -21, NULL, 10, true, CURRENT_TIMESTAMP),
  ('tpl_expenses', 'Alla utlägg för året är bokförda i Fortnox',
   'Utlägg med inköpsdatum under året ska vara attesterade, konterade och exporterade. Utkast räknas inte, eftersom de inte är inlämnade.',
   'SKATTFORMAN', 14, 'EXPENSES_EXPORTED', 20, true, CURRENT_TIMESTAMP),
  ('tpl_cards', 'Alla kortköp har ett utlägg',
   'Varje köp på sektionens kort under året ska ha ett utlägg. Bankhändelser visar vilka som saknas och vems kort de gjordes på.',
   'SKATTFORMAN', 14, 'CARD_PURCHASES_ACCOUNTED', 30, true, CURRENT_TIMESTAMP),
  ('tpl_income', 'Alla intäkter är bokförda i Fortnox',
   'Varje dag med intäkter under året ska vara bokförd och exporterad under Intäkter.',
   'SKATTFORMAN', 14, 'INCOME_EXPORTED', 40, true, CURRENT_TIMESTAMP),
  ('tpl_stocktake', 'Inventera lagret vid årsskiftet',
   'Räkna lagret så nära årsskiftet som möjligt och stäng inventeringen under Lager. Lagervärdet behövs för att stämma av lagerkontot.',
   'STOCKARE', 0, 'STOCKTAKE_AT_YEAR_END', 50, true, CURRENT_TIMESTAMP),
  ('tpl_accruals', 'Periodiseringar',
   'Gå igenom kostnader och intäkter som hör till ett annat år än det de bokfördes på: förutbetalda kostnader, upplupna kostnader och förutbetalda intäkter. Bokför dem i Fortnox per årets sista dag och vänd dem i början av nästa år.',
   'SKATTMASTARE', 30, NULL, 60, true, CURRENT_TIMESTAMP),
  ('tpl_depreciation', 'Avskrivningar på inventarier',
   'Bokför årets avskrivningar på sektionens inventarier per årets sista dag.',
   'SKATTMASTARE', 30, NULL, 70, true, CURRENT_TIMESTAMP),
  ('tpl_sync', 'Huvudboken är synkad efter den sista bokföringen',
   'Synka från Fortnox när det sista är bokfört, så att granskningen och avstämningarna utgår från samma siffror som Fortnox.',
   'SKATTMASTARE', 30, 'LEDGER_SYNCED', 80, true, CURRENT_TIMESTAMP),
  ('tpl_reconcile', 'Stäm av alla balanskonton i Fortnox',
   'Gör avstämningen i Fortnox och markera kontot som avstämt under Avstämningar. Skriv i kontots anteckning hur det stäms av, så slipper nästa skattmästare leta.',
   'SKATTMASTARE', 45, 'BALANCES_RECONCILED', 90, true, CURRENT_TIMESTAMP),
  ('tpl_treasury_review', 'Skattmästeriets genomgång av verifikationerna',
   'Gå igenom årets verifikationer under Verifikationer innan revisorerna får dem. Börja med de som saknar underlag och de som är flaggade.',
   'SKATTMASTARE', 45, 'TREASURY_REVIEWED', 100, true, CURRENT_TIMESTAMP),
  ('tpl_handover', 'Lämna över materialet till revisorerna',
   'Se till att revisorerna har rollen Revisor i appen, och skicka resultat- och balansräkningen från Utfall och rapporter.',
   'SKATTMASTARE', 60, NULL, 110, true, CURRENT_TIMESTAMP),
  ('tpl_auditors', 'Revisorernas granskning',
   'Revisorerna går igenom verifikationerna och godkänner dem, ställer frågor eller gör anmärkningar.',
   'REVISOR', 75, 'AUDITORS_REVIEWED', 120, true, CURRENT_TIMESTAMP),
  ('tpl_answers', 'Svara på revisorernas frågor',
   'Frågorna står på varje verifikation. Svara i tråden där, så att svaret finns kvar bredvid det den gäller.',
   'SKATTMASTARE', 80, NULL, 130, true, CURRENT_TIMESTAMP),
  ('tpl_report', 'Skriv den ekonomiska berättelsen',
   'Den ekonomiska delen av verksamhetsberättelsen: resultatet mot budget, de största avvikelserna och vad de beror på.',
   'SKATTMASTARE', 80, NULL, 140, true, CURRENT_TIMESTAMP),
  ('tpl_discharge', 'Revisionsberättelse och ansvarsfrihet',
   'Revisorerna skriver revisionsberättelsen, och mötet beslutar om ansvarsfrihet. Spara båda.',
   'SKATTMASTARE', NULL, NULL, 150, true, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
