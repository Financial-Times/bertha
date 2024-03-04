GET {{baseurl}}/view/publish/gss/1WwwQqmkTz5zwq1fV0rrSG9JVfrpComLvqxyadj0qnG8/Test
HTTP 200
[Asserts]
jsonpath "$.[0].a" == 1
jsonpath "$.[0].b" == 2

GET {{baseurl}}/view/publish/gss/1WwwQqmkTz5zwq1fV0rrSG9JVfrpComLvqxyadj0qnG8/SheetDoesNotExist
HTTP 404

GET {{baseurl}}/foo/bar
HTTP 404

GET {{baseurl}}/view/publish/gss/foo/Test
HTTP 400

GET {{baseurl}}/view/publish/gss/2WwXQqmkTz5zwq1ff0rrSG9JVfrpComLvqxyadj0qnG8/Test
HTTP 404