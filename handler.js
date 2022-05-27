const AWS = require("aws-sdk");
const express = require("express");
const serverless = require("serverless-http");
const jwt_decode = require("jwt-decode");

const app = express();

const STUDENTS_TABLE = process.env.STUDENTS_TABLE;
const USERPOOL_ID = process.env.USERPOOL_ID
const dynamoDbClient = new AWS.DynamoDB.DocumentClient();

app.use(express.json());

// app.use(cors({ credentials: true, origin: true }))


app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', true)
  res.header("Access-Control-Allow-Origin", "http://localhost:3000"); // restrict it to the required domain
  res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
  // Set custom headers for CORS
  res.header("Access-Control-Allow-Headers", "Content-type,Accept,X-Custom-Header");

  try {
    res.jwtpayload = jwt_decode(req.headers.authorization);
  } catch (e) {
    res.jwtpayload = {};
  }
  next()
})



// app.options('*', cors({
//   credentials: true,
//   preflightContinue: true,
//   origin: "https://1031-49-36-82-182.in.ngrok.io"
// }));

app.get("/", async function (req, res) {
  res.status(200).json({ message: "Hello" })
})

app.get("/students/:studentID", async function (req, res) {
  var cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
  try {
    var params = {
      UserPoolId: USERPOOL_ID, /* required */
      Username: req.params.studentID /* required */
    };
    const User = await cognitoidentityserviceprovider.adminGetUser(params).promise()
    var params = {
      TableName: STUDENTS_TABLE,
      Key: {
        studentID: req.params.studentID,
      },
    };
    const { Item } = await dynamoDbClient.get(params).promise();
    if (Item) {
      User.Item = Item
    }
    res.status(200).json({ User });
  } catch (error) {
    console.log(error);
    res.status(404).json({ error: "Could not find student" });
  }
});

app.get("/users", async function (req, res) {
  var cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();

  const users = []

  var params = {
    UserPoolId: USERPOOL_ID, /* required */
  };

  cognitoidentityserviceprovider.listGroups(params).promise().then(
    async data => {
      await Promise.all(data.Groups.map(async (groupEntity) => {
        var params = {
          GroupName: groupEntity.GroupName,
          UserPoolId: USERPOOL_ID, /* required */
        };
        await cognitoidentityserviceprovider.listUsersInGroup(params).promise().then((data1) => {
          data1.Users.map(userEntity => {
            userEntity["group"] = groupEntity.GroupName;
            users.push(userEntity);
          });
        }).catch(err1 => console.log(err1, err1.stack));
      }))
      res.status(200).json({ users });
    }).catch(err => { console.log(err, err.stack) });
});

app.post("/createuser", async function (req, res) {
  const { email, password, type, username } = req.body
  var cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();
  var params = {
    UserPoolId: USERPOOL_ID,
    Username: username,
    TemporaryPassword: password,
    UserAttributes: [
      {
        Name: 'email',
        Value: email
      }
    ]
  }
  if (type == "student") {
    params["UserAttributes"].push({
      Name: 'custom:departmentNo',
      Value: (req.body)["departmentNo"]
    })
    params["UserAttributes"].push({
      Name: 'custom:classNo',
      Value: (req.body)["classNo"]
    })
  }
  cognitoidentityserviceprovider.adminCreateUser(params, function (err, data) {
    if (err) {
      res.status(200).json({ message: err });
    }
    else {
      var params = {
        GroupName: type, /* required */
        UserPoolId: USERPOOL_ID, /* required */
        Username: username /* required */
      };
      cognitoidentityserviceprovider.adminAddUserToGroup(params, function (err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else {
          res.status(200).json({ message: data });
        };           // successful response
      });
    }
  })
});

app.post("/updatestudent", async function (req, res) {
  const { username, detail } = req.body
  const studentID = username;
  const params = {
    TableName: STUDENTS_TABLE,
    Item: {
      studentID: studentID,
    },
  };

  for (var key in detail) {
    params["Item"][key] = detail[key];
  }

  try {
    await dynamoDbClient.put(params).promise();
    res.json({ studentID });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Could not create user" });
  }
});

app.use((req, res, next) => {
  return res.status(404).json({
    error: "Not Found",
  });
});


module.exports.handler = serverless(app);
