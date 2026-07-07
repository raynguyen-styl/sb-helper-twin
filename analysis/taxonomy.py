"""SHARED stall-classification taxonomy — the single source of truth (v2, 7 Jul 2026).

Policy (supervisor: never guess what a stall sells):
  1. A stall gets a food category ONLY from words in its registered name.
  2. Corporate suffixes (pte ltd / enterprise / trading / marketing) are NOT evidence
     of anything — 44 such stalls (BL Marketing, Overseas Associates, ...) are
     Unclassified until someone at STYL confirms the vendor list.
  3. Names hitting 2+ food-word groups ("Hot Drinks and Snacks") -> 'Mixed'
     (they really are mixed stalls; rule order no longer picks a winner).
  4. BEHAVIOR VETO: a single food category is kept only when the stall's own modal
     price is consistent with the claim (n >= 100). The veto fires on strong
     contradiction only (a "cooked food" name trading at a $0.60 modal is a drink
     counter), NOT on premium pricing ($5 cafe meals at independent schools stay
     Cooked Food). Price can VETO a name — it never assigns a category.
  5. No hit / vetoed / generic name ("Stall 1") -> 'Unclassified' (price facts only).

Feb-2026 validation: 493 verified stalls / 17.5% of txns; 9 stalls vetoed (21k txns);
Mixed = 23 stalls (2.4%); pure 'Fruits' has ZERO stalls (all fruit stalls are combos
-> Mixed), so Fruits no longer appears as a category.

Usage in every pipeline script (all define a filtered view `tx` first):
    from taxonomy import STALLCAT_SQL
    con.sql(STALLCAT_SQL)                        # creates view `stallcat` over `tx`
    con.sql(\"\"\"CREATE OR REPLACE VIEW txm AS
      SELECT tx.*, sc.mcat FROM tx JOIN stallcat sc USING (schoolId, storeId)\"\"\")
"""

CATS = ["Drinks", "Snacks & Desserts", "Cooked Food", "Mixed", "Bookshop & Supplies", "Unclassified"]

STALLCAT_SQL = """
CREATE OR REPLACE VIEW stallcat AS
WITH s AS (
  SELECT schoolId, storeId, lower(any_value(storeName)) AS nm, count(*) AS n,
         mode(amount)/100.0 AS modal
  FROM tx GROUP BY schoolId, storeId
), f AS (
  SELECT *,
    (nm ~ '.*(fruit).*')::INT AS w_fruit,
    (nm ~ '.*(drink|cool |cups|cans|juice|avalanche|beverage|bubble|milk|tea |coffee|kopi|quench|thirst|arctic|antartic|freez|expresso|espresso|chill|sip|refreshing).*')::INT AS w_drink,
    (nm ~ '.*(snack|dessert|bites|waffle|ice cream|ice-cream|icecream|muffin|bakery|bread|toast|cookie|pastr|donut|popcorn|sweet).*')::INT AS w_snack,
    (nm ~ '.*(food|rice|noodle|mee |sushi|western|chicken|nasi|pasta|cuisine|medley|kitchen|delight|malay|halal|japanese|korean|soup|porridge|economy|vegetarian|duck|fish|laksa|wanton|ban mian|delicious|cafe|deli |wok|bowl|dim sum|grill|bento|curry|hot stall|rib).*')::INT AS w_cook,
    (nm ~ '.*(book|education|supply|supplies|stationer|uniform).*')::INT AS w_book
  FROM s
), c AS (
  SELECT *,
    CASE
      WHEN (w_fruit + w_drink + w_snack + w_cook) >= 2 THEN 'Mixed'
      WHEN w_fruit = 1 THEN 'Fruits'
      WHEN w_drink = 1 THEN 'Drinks'
      WHEN w_snack = 1 THEN 'Snacks & Desserts'
      WHEN w_cook  = 1 THEN 'Cooked Food'
      WHEN w_book  = 1 THEN 'Bookshop & Supplies'
      ELSE 'Unclassified' END AS namecat
  FROM f
)
SELECT schoolId, storeId, n AS stall_n, modal AS stall_modal, namecat,
  CASE  -- behavior veto: strong contradictions only (see module docstring)
    WHEN namecat = 'Drinks'            AND n >= 100 AND modal > 2.00 THEN 'Unclassified'
    WHEN namecat = 'Snacks & Desserts' AND n >= 100 AND modal > 3.50 THEN 'Unclassified'
    WHEN namecat = 'Fruits'            AND n >= 100 AND modal > 3.00 THEN 'Unclassified'
    WHEN namecat = 'Cooked Food'       AND n >= 100 AND (modal < 1.00 OR modal > 8.00) THEN 'Unclassified'
    ELSE namecat END AS mcat
FROM c
"""
