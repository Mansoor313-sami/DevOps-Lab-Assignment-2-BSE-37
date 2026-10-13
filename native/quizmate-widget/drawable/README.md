# Widget drawable resources

These XML shapes are the source-of-truth copies of the widget's gradient
and glass surfaces. They must be mirrored into:

    android/app/src/main/res/drawable/

Glance has no gradient API — `GlanceModifier.background()` only accepts a
flat colour — so every gradient, glass tint and soft edge in the widget is
a drawable applied through `background(ImageProvider(R.drawable.…))`. That
is the only way an Android AppWidget can render a gradient at all, since it
draws through `RemoteViews` rather than a live Compose tree.

| File | Purpose |
| --- | --- |
| `widget_bg_{light,dim,dark}.xml` | Outer widget canvas gradient |
| `widget_glass_{light,dim,dark}.xml` | Translucent "glass" card surface |
| `widget_tile_{light,dim,dark}.xml` | Stat tiles and toolbar pills |
| `widget_hero.xml` | Saturated accent gradient behind the attendance hero |
| `widget_hero_badge.xml` | Translucent disc behind the hero glyph |

The light/dim/dark split exists because a drawable cannot read the widget's
own theme preference — QuizMate's theme is a stored user choice, not the
system `uiMode`, so `res/drawable-night/` would resolve the wrong variant.
`QuizMateWidget.kt` picks the right resource id per theme instead.
