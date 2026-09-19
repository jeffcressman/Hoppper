We're doing a redesign of the whole app, using my design system, Lwlkcing Design System. We're also creating the interface for hop editing. The code features don't exist for this yet.

I've mocked up the UI, which at the most basically level is very similar to Endlesss, intentionally (I want it to feel familiar). The files are in @"project resources/Design/".

For now I want you to work out the design for the My Jams and Public James pages, which correspond to the combined Personal and Subscribed lists on the My Jams page and the Joinable list on the Public Jams page.

When the app opens it should open to the Public Jams page.

Click a jam should open the Hop Recording Page.

When a hop recording is stopped, it should then open in the Hops Editing page.

If you selected a jam from the My Jams page or the Public Jams page and then click Current Jam it will open the Hop Recording Page with that Jam.

We're not going to do UI for the Account or Settings pages yet other than you can put the logout function in the Settings Page. If the user isn't logged in then there is a login button on the Public Jams page that loads when the app loads. 

We haven't defined a metronome function yet. We'll do that later.

On the  Hop Recording Page, the rifff list is visual, showing rifffs as splats. A splat is defined in @"project resources/Design/Rifff visualiser exmaple.png". The splats are arranged in a horizontal line, with the current rifff highlighted. The user can click on a splat to select it, and the selected rifff will be played back.

You can design the Hops page for now. It lists the existing hops, let's you play, edit, or delete them.