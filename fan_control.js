var dgram = require("dgram");
const mqtt = require('mqtt');
var CronJob = require('cron').CronJob;
var client = dgram.createSocket("udp4");
var PORT = process.env.UDP_PORT||"4000";


const fans = new Map()
fans.set('Fan 1', {room: "Bathroom",IPadress: process.env.UDP_IP ||"***", ID: process.env.RL_ID||"***", IDSZ: "***"})
fans.set('Fan 2', {room: "Washroom", IPadress: process.env.UDP_IP ||"***", ID: process.env.RL_ID||"***", IDSZ: "***"})
fans.set('Fan 3', {room: "Treppenhaus", IPadress: process.env.UDP_IP ||"***", ID: process.env.RL_ID||"***", IDSZ: "***"})


//office
var IPadress = process.env.UDP_IP ||"***";
var ID = process.env.RL_ID||"***";
var IDSZ = "***";

console.log(fans)


var PWD = "1111"
var MQTTserver = process.env.MQTT_IP ||"***";
var MQTTPort = process.env.MQTT_PORT ||"***";

var mqtt_temp_message = "";
var header  = Buffer.from(
        [ 0xFD, 0xFD,   // Beginn des Pakets
         0x02,          // Protokolltyp
         0x10,          // ID Blockgroesse
         ]
        );

var PWDsizebuf = Buffer.from([0x04]);
var PWDbuf = Buffer.from(PWD);
var writeFlevelbuf = Buffer.from('init');
var writeModebuf = Buffer.from('init');

const clientId = `mqtt_${Math.random().toString(16).slice(3)}`;

var mqtt_url = 'mqtt://***';


console.log(mqtt_url)
//console.log(mqtt_url);
//mqtt connection
options={
	clientId:"***",
	username:"***",
	password:"***",
	clean:true};

const mqtt_client  = mqtt.connect(mqtt_url, options);

mqtt_client.on('connect', function(){
	for(i=0; i < fans.size; i++) {
		fan = fans.get(`Fan ${i+1}`)
		room = fan.room
		mqtt_client.subscribe(`/rl/${room}/cmnd/mode`)
		mqtt_client.subscribe(`/rl/${room}/cmnd/fan_level`)
	}
	console.log("connected to mqtt");
	

//	mqtt_client.publish('/rl/washroom/#')
//	mqtt_client.subscribe('rl/washroom/cmnd/mode')

	}
);
console.log("finished")

function getMapByTopic(topic){
    room = topic.split('rl/').pop().split('/cmnd')[0];
    console.log(room);
	for(i = 1; i <= fans.size; i++) {
		fan = fans.get(`Fan ${i}`)
		if (fan.room == room) {
			return fan;
		}
	} 
}

mqtt_client.on('message', function(topic, message){
	// chek which fan
	
	fan = getMapByTopic(topic);
	var IDbuf = Buffer.from(fan.ID); 
	//message ist Buffer
	console.log(topic + "   " + message);
	if(topic.includes("fan_level")){ 
		// construct fan_level write message
		var dataarr = new Uint8Array(1);
		dataarr[0] = parseInt(message.toString());
		var writeFlevelDatabuf = Buffer.from([0x02, 0x02]);
		writeFlevelbuf = Buffer.concat([header, IDbuf, PWDsizebuf, PWDbuf, writeFlevelDatabuf, Buffer.from(dataarr.buffer)]);
		var checksum_writeFlevel = calcchecksum(writeFlevelbuf);
		writeFlevelbuf = Buffer.concat([writeFlevelbuf,checksum2buffer(checksum_writeFlevel)]);
		console.log(writeFlevelbuf);
		client.send(writeFlevelbuf, PORT, fan.IPadress);
		console.log("fan level case");
	}
	else if(topic.includes("mode")){
		// construct Mode write message
		var error = 0;
		var modedataarr = new Uint8Array(1);
                if(message.toString() == "ventilation"){modedataarr[0] = 0;}
                else if(message.toString() == "regeneration"){modedataarr[0] = 1;}
                else if(message.toString() == "supplyair"){modedataarr[0] = 2;}
		else {
			console.log("bad mode command", message.toString());
			error = 1;
			}
		if(error == 0){
			var writeModeDatabuf = Buffer.from([0x02, 0xB7]);
			writeModebuf = Buffer.concat([header, IDbuf, PWDsizebuf, PWDbuf, writeModeDatabuf, Buffer.from(modedataarr.buffer)]);
			var checksum_writeMode = calcchecksum(writeModebuf);
			writeModebuf = Buffer.concat([writeModebuf,checksum2buffer(checksum_writeMode)]);
			console.log(writeModebuf);
			client.send(writeModebuf, PORT, fan.IPadress);
			}
		console.log("mode case");
	}
	else{
		console.log(message.toString())
	}
});



// UDP
client.on("message", function(message, rinfo) {
	
	fan = getMapByIP(rinfo.address);
	console.log("received: ", message, rinfo);
	datalen = rinfo.size - 24 - message.readInt8(20);
	databuf = message.subarray(20+message.readInt8(20)+2, -2) //20 byte upfront, pwd length, pwd, func
	for (let i=0; i < datalen; i+=2){
		//console.log("data = ", databuf[i]);
		switch(databuf[i]){
			case(1):
				//console.log("RL ist  ", databuf[i+1]?"an":"aus");
				mqtt_client.publish(`/rl/${fan.room}/status`, databuf[i+1]?"on":"off", { qos: 0, retain: true });
				break;
			case(2):
				//console.log("Lueftungsstufe ist ", databuf[i+1]);
				mqtt_client.publish(`/rl/${fan.room}/fan_level`, databuf[i-1]?databuf[i+1].toString():"0", { qos: 0, retain: true });
				break;
			case(37): //0x25
				//console.log("Feuchtigkeit Bad ist ", databuf[i+1]);
				mqtt_client.publish(`/rl/${fan.room}/humidity`, databuf[i+1].toString(), { qos: 0, retain: true });
				break;
			case(183): //0xB7
				if(databuf[i+1].toString() == "0"){mqtt_temp_message = "ventilation";}
				else if(databuf[i+1].toString() == "1"){mqtt_temp_message = "regeneration";}
				else if(databuf[i+1].toString() == "2"){mqtt_temp_message = "supplyair";}
				else {mqtt_temp_message = "error"+ databuf[i+1].toString();} 
				mqtt_client.publish(`/rl/${fan.room}/mode`, mqtt_temp_message, { qos: 0, retain: true });
                                break;
			default:
				console.log("unknown ID");
				console.log(message, rinfo)
		}
	}

});

client.bind(PORT);

function getMapByIP(ip){
	console.log(ip + "    hh")

	for(i = 1; i <= fans.size; i++) {
		fan = fans.get(`Fan ${i}`)
		if (ip == fan.IPadress) {
			return fan; 
		}
	}
}

function calcchecksum(intbuff){
	let checksum = 0;
	for (let i = 2; i < intbuff.length; i++) {
  		// console.log(newbuff[i]);
  		checksum+=intbuff[i];
	}
	//console.log("checksum = " , checksum);
	return checksum;
}

function checksum2buffer(checksum){
	const arr = new Uint8Array(2);
	arr[0] = checksum%256;
	arr[1] = checksum/256;
	return Buffer.from(arr.buffer);
}

function buildBuffer(ID) {
    var PWD = "1111"
    var mqtt_temp_message = "";
    var header  = Buffer.from(
            [ 0xFD, 0xFD,   // Beginn des Pakets
            0x02,          // Protokolltyp
            0x10,          // ID Blockgroesse
            ]
            );

    var IDbuf = Buffer.from(ID); 
    var PWDsizebuf = Buffer.from([0x04]);
    var PWDbuf = Buffer.from(PWD)
    var writeFlevelbuf = Buffer.from('init');
    var writeModebuf = Buffer.from('init');


    var Databuf = Buffer.from([0x01, 0x01, 0x02, 0x25, 0xB7]);

    var list = [header, IDbuf, PWDsizebuf, PWDbuf, Databuf];
    var intbuff = Buffer.concat(list);

    //calculate checksum
    let checksum = calcchecksum(intbuff);
    //const arr = new Uint8Array(2);
    //arr[0] = checksum%256;
    //arr[1] = checksum/256;
    //const checksumbuff = Buffer.from(arr.buffer);

    var list2 = [intbuff,checksum2buffer(checksum)];
    var getbuff = Buffer.concat(list2);
    //console.log(getbuff);
    return getbuff;
}

var job = new CronJob('*/10 * * * * *', function() {
	//client.send(getbuff, PORT, IPadress);
	console.log("send...")
	for(i = 1; i <= fans.size; i++) {
		fan = fans.get(`Fan ${i}`)
		client.send(buildBuffer(fan.ID), PORT, fan.IPadress);
	}
	
 	//console.log('You will see this message every second');
}, null, true, 'Europe/Berlin');
job.start();

