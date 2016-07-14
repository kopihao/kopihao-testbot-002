var restify = require('restify');
var builder = require('../../core/');

var storeData = {
	"1" : {
		info : 'Black T-Shirt',
		desc : 'Order your very own Im A Sales Coordinator To Save Time Job T-Shirt.',
		img : "http://www.occupationtshirts.com/products/1/9417845.png",
		view : "http://www.occupationtshirts.com/view/9417845/im-a-sales-coordinator-to-save-time-job-t-shirt",
		units : 200,
		cost : 'RM200'
	},
	"2" : {
		info : 'Classic White T-Shirt',
		desc : 'Classic white fun job T-Shirt.',
		img : "http://www.occupationtshirts.com/products/3/12373697.png",
		view : "http://www.occupationtshirts.com/view/12373697/sales_coordinator_this_girl_loves_her_job_fun_t_shirt",
		units : 100,
		total : 'RM180'
	},
	"3" : {
		info : 'Burgundy Boot',
		desc : 'Timberland Mens Af 6 In Burgundy Boots US 11 NIB',
		img : "https://images-na.ssl-images-amazon.com/images/I/91BLuEbfQBL._UY500_.jpg",
		view : "https://www.amazon.com/Timberland-Mens-Burgundy-Boots-NIB/dp/B000VAF9XC/180-1566719-4116350",
		units : 80,
		total : 'RM300'
	}
};

//=========================================================
// Bot Setup
//=========================================================

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
	console.log('%s listening to %s', server.name, server.url);
});

// Create chat bot
var connector = new builder.ChatConnector({
    //appId: process.env.MICROSOFT_APP_ID,
    //appPassword: process.env.MICROSOFT_APP_PASSWORD
	//appId: "1ad09807-5683-43d4-9c1b-990382b7da28",
	//appPassword: "nHbbDSwCXYpdLWhXm7ETFEB"
	appId: "e3fea5af-90bb-4990-b1a5-0e5cf845544b",
	appPassword: "9cHpWJX9D6nYJWBLjb0kcRd"
	});
var bot = new builder.UniversalBot(connector);
server.post('/api/messages', connector.listen());

//=========================================================
// Bots Dialogs
//=========================================================

bot.dialog('/', [
		function (session) {
			// Send a greeting and start the menu.
			var card = new builder.HeroCard(session)
				.title("SME Chat Bot")
				.text("Hello (wave) Welcome to SME Chat Bot")
				.images([
						builder.CardImage.create(session, "http://i.imgur.com/xA4YAwK.png")
					]);
			var msg = new builder.Message(session).attachments([card]);
			session.send(msg);
			builder.Prompts.text(session, "Type 'Hi' to begin");
		},
		function (session, results) {
			if (results.response == 'Hi') {
				session.beginDialog('/Hi');
			} else if (results.response == 'hi') {
				session.beginDialog('/Hi');
			} else if (0 != results.response.length) {
				session.beginDialog('/');
			} else {
				// Always say goodbye
				session.send("Goodbye!");
			}
		}
	]);

bot.dialog('/Hi', [
		// Begin Menu dialog
		function (session) {
			session.replaceDialog('/menu');
		},
		function (session, results) {
			// Exit 'Hi'
			session.endDialog();
			// Always say goodbye
			session.send("Invalid option! Type anything to start again.");
		}
	]);

bot.dialog('/menu', [
		function (session) {
			var menuSel = new builder.Message(session)
				.textFormat(builder.TextFormat.xml)
				.attachments([
						new builder.HeroCard(session)
						.title("What are you looking for today?")
						.subtitle("Select an option")
						.text("View our store items, find out our location or get our store information.")
						.images([
								builder.CardImage.create(session, "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Seattlenighttimequeenanne.jpg/320px-Seattlenighttimequeenanne.jpg")
							])
						.buttons([
								builder.CardAction.imBack(session, "Enter:1", "Enter store"),
								builder.CardAction.openUrl(session, "http://www.silverlakegroup.com/contact", "Find location"),
								builder.CardAction.openUrl(session, "http://www.silverlakegroup.com/about/company%E2%80%99s-profile/", "Store Information")
							])
					]);
			builder.Prompts.choice(session, menuSel, "Enter:1");
		},
		function (session, results) {
			if (results.response) {
				var kvPair = results.response.entity.split(':');
				switch (kvPair[1]) {
				case '1':
					session.replaceDialog('/store');
					break;
				}
			} else {
				session.endDialog();
			}
		},
		function (session, results) {
			// The menu runs a loop until the user chooses to (quit).
			session.replaceDialog('/menu');
		}
	]);

bot.dialog('/store', [
		// Begin store dialog
		function (session) {
			// Ask the user to select an item from a carousel.
			var item1 = storeData['1'];
			var item2 = storeData['2'];
			var item3 = storeData['3'];
			var msg = new builder.Message(session)
				.textFormat(builder.TextFormat.xml)
				.attachmentLayout(builder.AttachmentLayout.carousel)
				.attachments([
						new builder.HeroCard(session)
						.title(item1['info'])
						.text(item1['desc'])
						.images([
								builder.CardImage.create(session, item1['img'])
							])
						.buttons([
								builder.CardAction.openUrl(session, item1['view'], "View Item"),
								builder.CardAction.imBack(session, "Buy:1", "Buy Item")
							]),
						new builder.HeroCard(session)
						.title(item2['info'])
						.text(item2['desc'])
						.images([
								builder.CardImage.create(session, item2['img'])
							])
						.buttons([
								builder.CardAction.openUrl(session, item2['view'], "View Item"),
								builder.CardAction.imBack(session, "Buy:2", "Buy Item")
							]),
						new builder.HeroCard(session)
						.title(item3['info'])
						.text(item3['desc'])
						.images([
								builder.CardImage.create(session, item3['img'])
							])
						.buttons([
								builder.CardAction.openUrl(session, item3['view'], "View Item"),
								builder.CardAction.imBack(session, "Buy:3", "Buy Item")
							])
					]);
			builder.Prompts.choice(session, msg, "Buy:1|Buy:2|Buy:3");
		},
		function (session, results) {
			if (results.response) {
				var kvPair = results.response.entity.split(':');
				session.replaceDialog('/buy', kvPair[1]);
			} else {
				// Exit 'store'
				session.endDialog();
				// Always say goodbye
				session.send("Invalid item! Type anything to start again.");
			}
		}
	]);

var curItem = storeData['1'];
bot.dialog('/buy', [
		// Begin buy dialog
		function (session, args) {
			if (0 != args.length) {
				curItem = storeData[args];
				var itemSel = new builder.Message(session)
					.textFormat(builder.TextFormat.xml)
					.attachments([
							new builder.HeroCard(session)
							.title(curItem['info'])
							.subtitle(curItem['cost'])
							.text(curItem['desc'])
							.images([
									builder.CardImage.create(session, curItem['img'])
								])
							.buttons([
									builder.CardAction.imBack(session, "Confirm", "Confirm"),
									builder.CardAction.imBack(session, "Back", "Back")
								])
						]);
				builder.Prompts.choice(session, itemSel, "Confirm|Back");
			} else {
				// Exit 'buy'
				session.endDialog();
				// Always say goodbye
				session.send("Invalid buy! Type anything to start again.");
			}
		},
		function (session, results) {
			if (results.response) {
				var action = results.response.entity;
				if (action === 'Confirm') {
					session.replaceDialog('/receipt', curItem);
				} else {
					session.replaceDialog('/store');
				}
			} else {
				// Exit 'buy'
				session.endDialog();
				// Always say goodbye
				session.send("Invalid action! Type anything to start again.");
			}
		}
	]);

bot.dialog('/receipt', [
		// Begin Receipt dialog
		function (session, args) {
			if (0 != args.length) {
				session.send("Purchase confirmed. You order of '" + args['info'] + "' is being processed. Please check your receipt. Thank you!");

				// Send a receipt with images
				var msg = new builder.Message(session)
					.attachments([
							new builder.ReceiptCard(session)
							.title("Order Confirmation")
							.items([
									builder.ReceiptItem.create(session)
									.image(builder.CardImage.create(session, args['img']))
									.price(args['cost'])
									.quantity('1')
									.subtitle(args['info'])
								])
							.facts([
									builder.Fact.create(session, "Cash", "Paid with"),
									builder.Fact.create(session, "No 288, Jalan Raja Laut, Kuala Lumpur, KL 35250", "Deliver to")
								])
							.total(args['cost'])
						]);
				session.endDialog(msg);
			} else {
				// Exit 'receipt'
				session.endDialog();
				// Always say goodbye
				session.send("Invalid receipt! Type anything to start again.");
			}
		},
		function (session, results) {
			// Exit 'receipt'
			session.endDialog();
			// Always say goodbye
			session.send("Session end! Come back again (smile)");
		}
	]);
