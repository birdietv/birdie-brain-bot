if (process.env.NODE_ENV !== "production") require("dotenv").config();
const tmi = require("tmi.js");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const client = new tmi.Client({
  options: { debug: true },
  identity: {
    username: process.env.TWITCH_USERNAME,
    password: process.env.TWITCH_OAUTH,
  },
  channels: [process.env.TWITCH_CHANNEL],
});

client.connect();

client.on("message", async (channel, tags, message, self) => {
  if (self) return;

  const username = tags["display-name"].toLowerCase();
  const msg = message.trim();

  // ── !task [task name] ─────────────────────────────────────────────────────
  if (msg.toLowerCase().startsWith("!task ")) {
    const task = msg.slice(6).trim();
    if (!task) return;

    const { error } = await supabase
      .from("community_tasks")
      .insert({ username, task });

      if (error) {
        console.error("Supabase insert error:", JSON.stringify(error));
        client.say(channel, `@${username} something went wrong adding your task!`);
      } else {
        client.say(channel, `@${username} task added: "${task}" 🐦`);
      }
  }

  // ── !tasks ────────────────────────────────────────────────────────────────
  else if (msg.toLowerCase() === "!tasks") {
    const { data } = await supabase
      .from("community_tasks")
      .select("*")
      .eq("done", false)
      .order("created_at", { ascending: true });

    if (!data || data.length === 0) {
      client.say(channel, "No community tasks yet! Type !task [task name] to add one 🐦");
      return;
    }

    // Group by username
    const grouped = data.reduce((acc, t) => {
      if (!acc[t.username]) acc[t.username] = [];
      acc[t.username].push(t);
      return acc;
    }, {});

    const lines = Object.entries(grouped).map(([user, tasks]) => {
      const taskList = tasks.map((t, i) => `${i + 1}. ${t.task}`).join("  ");
      return `${user}: ${taskList}`;
    });

    client.say(channel, "📋 Community Tasks — " + lines.join(" | "));
  }

  // ── !mytasks ──────────────────────────────────────────────────────────────
  else if (msg.toLowerCase() === "!mytasks") {
    const { data: userTasks } = await supabase
      .from("community_tasks")
      .select("*")
      .eq("username", username)
      .eq("done", false)
      .order("created_at", { ascending: true });

    if (!userTasks || userTasks.length === 0) {
      client.say(channel, `@${username} you have no active tasks! Type !task to add one 🐦`);
      return;
    }

    const taskList = userTasks.map((t, i) => `${i + 1}. ${t.task}`).join("  ");
    client.say(channel, `@${username} your tasks: ${taskList}`);
  }

  // ── !done all ─────────────────────────────────────────────────────────────
  else if (msg.toLowerCase() === "!done all") {
    const { error } = await supabase
      .from("community_tasks")
      .update({ done: true })
      .eq("username", username)
      .eq("done", false);

    if (error) {
      client.say(channel, `@${username} something went wrong!`);
    } else {
      client.say(channel, `@${username} all your tasks are done! Great work! 🎉`);
    }
  }

  // ── !done [number or name] ────────────────────────────────────────────────
  else if (msg.toLowerCase().startsWith("!done ")) {
    const arg = msg.slice(6).trim();

    // Get all of this user's incomplete tasks
    const { data: userTasks } = await supabase
      .from("community_tasks")
      .select("*")
      .eq("username", username)
      .eq("done", false)
      .order("created_at", { ascending: true });

    if (!userTasks || userTasks.length === 0) {
      client.say(channel, `@${username} you have no active tasks!`);
      return;
    }

    let taskToComplete = null;

    // Check if arg is a number
    const num = parseInt(arg);
    if (!isNaN(num) && num >= 1 && num <= userTasks.length) {
      taskToComplete = userTasks[num - 1];
    } else {
      // Try to match by name
      taskToComplete = userTasks.find(t =>
        t.task.toLowerCase() === arg.toLowerCase()
      );
    }

    if (!taskToComplete) {
      client.say(channel, `@${username} couldn't find that task! Use !tasks to see your list.`);
      return;
    }

    const { error } = await supabase
      .from("community_tasks")
      .update({ done: true })
      .eq("id", taskToComplete.id);

    if (error) {
      client.say(channel, `@${username} something went wrong!`);
    } else {
      client.say(channel, `@${username} "${taskToComplete.task}" marked as done! 🎉`);
    }
  }
  // ── !reset (broadcaster and mods only) ───────────────────────────────────
  // ── !reset (mods/broadcaster only) ───────────────────────────────────────
  else if (msg.toLowerCase() === "!reset all") {
    const isMod = tags.mod;
    const isBroadcaster = tags.username === process.env.TWITCH_CHANNEL.toLowerCase();

    if (!isMod && !isBroadcaster) {
      client.say(channel, `@${username} only mods can do that!`);
      return;
    }

    const { error } = await supabase
      .from("community_tasks")
      .delete()
      .neq("id", 0);

    if (error) {
      client.say(channel, "Something went wrong!");
    } else {
      client.say(channel, "All tasks have been cleared! Fresh start 🐦");
    }
  }

  else if (msg.toLowerCase() === "!reset") {
    const isMod = tags.mod;
    const isBroadcaster = tags.username === process.env.TWITCH_CHANNEL.toLowerCase();

    if (!isMod && !isBroadcaster) {
      client.say(channel, `@${username} only mods can do that!`);
      return;
    }

    const { error } = await supabase
      .from("community_tasks")
      .delete()
      .eq("done", true);

    if (error) {
      client.say(channel, "Something went wrong!");
    } else {
      client.say(channel, "Completed tasks cleared! 🐦");
    }
  }
// ── !remove [username] [number] (mods/broadcaster only) ──────────────────
else if (msg.toLowerCase().startsWith("!remove ")) {
  const isMod = tags.mod;
  const isBroadcaster = tags.username === process.env.TWITCH_CHANNEL.toLowerCase();

  if (!isMod && !isBroadcaster) {
    client.say(channel, `@${username} only mods can remove tasks!`);
    return;
  }

  const args = msg.slice(8).trim().split(" ");
  const targetUser = args[0].toLowerCase().replace("@", "");
  const taskNum = parseInt(args[1]);

  if (!targetUser || isNaN(taskNum)) {
    client.say(channel, `@${username} usage: !remove [username] [task number]`);
    return;
  }

  const { data: userTasks } = await supabase
    .from("community_tasks")
    .select("*")
    .eq("username", targetUser)
    .eq("done", false)
    .order("created_at", { ascending: true });

  if (!userTasks || userTasks.length === 0) {
    client.say(channel, `@${username} no active tasks found for ${targetUser}!`);
    return;
  }

  if (taskNum < 1 || taskNum > userTasks.length) {
    client.say(channel, `@${username} invalid task number! ${targetUser} has ${userTasks.length} active task(s).`);
    return;
  }

  const taskToRemove = userTasks[taskNum - 1];

  const { error } = await supabase
    .from("community_tasks")
    .delete()
    .eq("id", taskToRemove.id);

  if (error) {
    client.say(channel, `Something went wrong removing the task!`);
  } else {
    client.say(chan

});