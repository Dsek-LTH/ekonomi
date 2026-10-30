-- The skattmästare reads everyone's redovisningsbetyg, being the one who chases
-- late utlägg. A row, so the section can give it to somebody else under
-- Inställningar → Roller.
INSERT INTO "RoleCapability" ("role", "capability")
VALUES ('SKATTMASTARE', 'MEMBER_SCORE_VIEW')
ON CONFLICT DO NOTHING;
